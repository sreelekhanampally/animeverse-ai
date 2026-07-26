// AnimeVerse AI service layer.
// Uses process.env.OPENAI_API_KEY. If the key is missing, functions return
// deterministic stub data so the app remains usable in dev.

import OpenAI from "openai";
import fs from "fs";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

let client = null;
export const hasAI = () => Boolean(OPENAI_KEY);

const getClient = () => {
    if (!hasAI()) return null;
    if (!client) client = new OpenAI({ apiKey: OPENAI_KEY });
    return client;
};

// ---------- Chat / completion ----------
export async function chatComplete({ system, user, temperature = 0.4, json = false }) {
    const c = getClient();
    if (!c) {
        // Stub for local dev without a key
        return json ? { reply: "(AI stub) OpenAI key not set." } : "(AI stub) OpenAI key not set.";
    }
    const resp = await c.chat.completions.create({
        model: MODEL,
        temperature,
        response_format: json ? { type: "json_object" } : undefined,
        messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: user },
        ],
    });
    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    if (json) {
        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }
    }
    return text;
}

// ---------- Embeddings ----------
export async function embedText(text) {
    if (!text?.trim()) return [];
    const c = getClient();
    if (!c) {
        // Cheap deterministic hash-based pseudo-embedding for dev
        const dim = 32;
        const v = new Array(dim).fill(0);
        for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i);
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map((x) => x / norm);
    }
    const resp = await c.embeddings.create({ model: EMBED_MODEL, input: text });
    return resp.data?.[0]?.embedding || [];
}

// ---------- Cosine similarity ----------
export function cosineSim(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------- Video summary ----------
export async function summarizeVideo({ title, description, transcript = "" }) {
    const source = [
        `Title: ${title}`,
        `Description: ${description}`,
        transcript ? `Transcript:\n${transcript.slice(0, 6000)}` : "",
    ]
        .filter(Boolean)
        .join("\n\n");

    const prompt = `Summarize this anime-community video in 4-6 concise bullet points, then a one-line TL;DR. Return valid JSON: { "bullets": string[], "tldr": string }.`;

    return chatComplete({
        system: "You are an assistant that produces concise, spoiler-free summaries for anime videos.",
        user: `${prompt}\n\n---\n${source}`,
        json: true,
        temperature: 0.3,
    });
}

// ---------- Auto tagging ----------
export async function autoTagAndSummarize({ title, description }) {
    const c = getClient();
    if (!c) {
        // Stub tags derived from words
        const words = `${title} ${description}`
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 4);
        return {
            tags: [...new Set(words)].slice(0, 6),
            summary: description.slice(0, 200),
        };
    }
    return chatComplete({
        system: "Extract anime/video metadata as JSON.",
        user: `Given the anime video below, return JSON:
{
  "tags": string[]  // 5-10 lowercase tags, anime-relevant
  "category": string, // one of: AMV, Review, Discussion, News, Tutorial, Reaction, ClipCompilation, Interview, Other
  "summary": string   // 1-2 sentence neutral summary, no spoilers
}

Title: ${title}
Description: ${description}`,
        json: true,
        temperature: 0.2,
    }).then((r) => ({
        tags: Array.isArray(r.tags) ? r.tags.slice(0, 10) : [],
        summary: r.summary || "",
        category: r.category || "General",
    }));
}

// ---------- Chat with a video (RAG over transcript) ----------
export async function askVideo({ title, transcript, question }) {
    const context = (transcript || "").slice(0, 8000);
    return chatComplete({
        system:
            "You answer questions about a specific anime video, based ONLY on the provided context. If the context does not contain the answer, say so honestly.",
        user: `Video: ${title}\n\nContext:\n${context}\n\nQuestion: ${question}`,
        temperature: 0.3,
    });
}

// ---------- Sentiment on a batch of comments ----------
export async function commentSentiment(comments) {
    if (!comments?.length) return { positive: 0, neutral: 0, negative: 0, samples: [] };
    const c = getClient();
    if (!c) {
        // Naive heuristic fallback
        const positives = ["love", "great", "amazing", "best", "awesome", "goat"];
        const negatives = ["hate", "bad", "worst", "trash", "cringe"];
        let p = 0;
        let n = 0;
        for (const t of comments) {
            const s = t.toLowerCase();
            if (positives.some((w) => s.includes(w))) p++;
            else if (negatives.some((w) => s.includes(w))) n++;
        }
        const neutral = comments.length - p - n;
        return { positive: p, neutral, negative: n };
    }
    return chatComplete({
        system: "You classify anime video comments into sentiment buckets.",
        user: `Classify each comment as positive, neutral, or negative and return JSON:
{ "positive": number, "neutral": number, "negative": number, "highlights": string[] }
Comments (one per line):
${comments.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
        json: true,
        temperature: 0.1,
    });
}

// ---------- Transcription (Whisper) ----------
export async function transcribeAudio(localFilePath, { lang } = {}) {
    const c = getClient();
    if (!c) return { text: "(AI stub) transcription unavailable  -  set OPENAI_API_KEY.", language: lang || "en" };
    const resp = await c.audio.transcriptions.create({
        model: TRANSCRIBE_MODEL,
        file: fs.createReadStream(localFilePath),
        language: lang,
        response_format: "verbose_json",
    });
    return { text: resp.text, language: resp.language, segments: resp.segments };
}

// ---------- Translation ----------
export async function translateText(text, targetLang = "en") {
    return chatComplete({
        system: `Translate the user's text to ${targetLang}. Preserve tone. Output only the translation.`,
        user: text,
        temperature: 0.2,
    });
}
