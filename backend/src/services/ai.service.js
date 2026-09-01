/**
 * AnimeVerse AI service layer.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This file used to fabricate results whenever OPENAI_API_KEY was absent:
 *   - `embedText` returned a 32-dimensional hash-derived vector,
 *   - `chatComplete` returned "(AI stub) OpenAI key not set.",
 *   - `autoTagAndSummarize` returned the longest words in the title as "tags",
 *   - `commentSentiment` counted six hard-coded positive words,
 *   - `transcribeAudio` returned an error sentence as if it were a transcript.
 *
 * Every one of those made an unconfigured deployment look configured. The
 * embedding case was actively harmful — the fake vector was persisted next to real
 * 1536-dimensional ones in the same field, so the collection ended up holding two
 * incompatible kinds of vector with nothing recording which was which, and
 * semantic search returned confident-looking nonsense.
 *
 * The stub sentence being persisted is not hypothetical either: the summary
 * controller writes whatever it receives to `Video.aiSummary`, so "(AI stub)
 * OpenAI key not set." could be sitting in real documents. `isTranscriptEligible`
 * in utils/embeddingText.js therefore screens those markers out rather than
 * embedding a sentence about missing configuration.
 *
 * Now every AI function either does the real thing or throws AIUnavailableError,
 * which carries statusCode 503 and is turned into an honest "AI is not configured"
 * response by the global error handler in app.js.
 *
 * The vector path lives in services/embedding.service.js; the identity of the
 * model lives in config/embedding.config.js. Both are re-exported here so existing
 * importers of this module keep working.
 */

import OpenAI from "openai";
import fs from "fs";
import { EmbeddingUnavailableError } from "../config/embedding.config.js";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    EmbeddingValidationError,
    activeEmbeddingIdentity,
    cosineSimilarity,
    describeEmbeddingState,
    embeddingStatus,
    generateEmbedding,
    hasEmbeddingProvider,
    isSearchableEmbedding,
} from "./embedding.service.js";

// Re-exported so ai.controller.js and the backfill script have one import site.
export {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    EmbeddingUnavailableError,
    EmbeddingValidationError,
    activeEmbeddingIdentity,
    cosineSimilarity,
    describeEmbeddingState,
    embeddingStatus,
    generateEmbedding,
    hasEmbeddingProvider,
    isSearchableEmbedding,
};

/**
 * Chat/completion model. Unlike the embedding model this one stays env-driven:
 * swapping a chat model changes wording, not data compatibility, and nothing
 * persisted depends on which one produced it.
 */
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

/**
 * Raised by every non-embedding AI helper when no key is configured. Shares the
 * 503 semantics of EmbeddingUnavailableError — the service is healthy, it is
 * simply unconfigured, which is an operational state and not a crash.
 */
export class AIUnavailableError extends Error {
    constructor(feature = "This AI feature") {
        super(`${feature} is unavailable: OPENAI_API_KEY is not configured.`);
        this.name = "AIUnavailableError";
        this.isUnavailable = true;
        this.statusCode = 503;
    }
}

/** Kept for backwards compatibility with existing callers of the old scaffold. */
export const hasAI = () => hasEmbeddingProvider();

let client = null;
const getClient = (feature) => {
    if (!hasAI()) throw new AIUnavailableError(feature);
    if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });
    return client;
};

/* ------------------------------------------------------------------ *
 * Embeddings — compatibility shim over embedding.service.js
 * ------------------------------------------------------------------ */

/**
 * Returns a bare 1536-float vector for the given text.
 *
 * Kept because the old `embedText` name is already imported by ai.controller.js.
 * Prefer `generateEmbedding`, which also returns the model/version/hash metadata
 * that must be persisted with the vector — this function deliberately discards it,
 * so anything writing to the database should not use it.
 *
 * Throws rather than fabricating a vector when unconfigured. That is the entire
 * point of this rewrite.
 */
export async function embedText(text) {
    const { embedding } = await generateEmbedding(text);
    return embedding;
}

/**
 * Deprecated alias for `cosineSimilarity`, which returns null for incomparable
 * vectors where this returns 0.
 *
 * The 0 is why this is deprecated: it made a 32-float legacy vector and a real
 * 1536-float query vector score 0 — indistinguishable from a genuinely unrelated
 * pair, and ranked above anything scoring negative. Callers should filter on
 * `isSearchableEmbedding` first and use `cosineSimilarity`.
 */
export function cosineSim(a, b) {
    const score = cosineSimilarity(a, b);
    return score === null ? 0 : score;
}

/* ------------------------------------------------------------------ *
 * Chat / completion
 * ------------------------------------------------------------------ */

export async function chatComplete({ system, user, temperature = 0.4, json = false }) {
    const c = getClient("Chat completion");
    const resp = await c.chat.completions.create({
        model: CHAT_MODEL,
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

/* ------------------------------------------------------------------ *
 * Video summary
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Auto tagging
 * ------------------------------------------------------------------ */

export async function autoTagAndSummarize({ title, description }) {
    // No word-frequency fallback. Splitting a title on non-word characters and
    // keeping words longer than four letters produced "tags" like "shippuden
    // official trailer" — plausible enough to be written to the database and then
    // fed into an embedding, where they would degrade the vector with noise.
    const result = await chatComplete({
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
    });

    return {
        tags: Array.isArray(result.tags) ? result.tags.slice(0, 10) : [],
        summary: result.summary || "",
        category: result.category || "General",
    };
}

/* ------------------------------------------------------------------ *
 * Chat with a video
 * ------------------------------------------------------------------ */

export async function askVideo({ title, transcript, question }) {
    const context = (transcript || "").slice(0, 8000);
    return chatComplete({
        system:
            "You answer questions about a specific anime video, based ONLY on the provided context. If the context does not contain the answer, say so honestly.",
        user: `Video: ${title}\n\nContext:\n${context}\n\nQuestion: ${question}`,
        temperature: 0.3,
    });
}

/* ------------------------------------------------------------------ *
 * Sentiment on a batch of comments
 * ------------------------------------------------------------------ */

export async function commentSentiment(comments) {
    if (!comments?.length) return { positive: 0, neutral: 0, negative: 0, samples: [] };

    // The old six-keyword heuristic classified anything without those words as
    // "neutral", so a wall of criticism reported as neutral and looked like a
    // working sentiment feature.
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

/* ------------------------------------------------------------------ *
 * Transcription (Whisper)
 * ------------------------------------------------------------------ */

/**
 * Transcribes a LOCAL audio file that a creator uploaded through multer.
 *
 * Scope, stated explicitly because it is a hard project rule: this only ever runs
 * on a file the operator already has on disk from a creator upload. YouTube media
 * is never downloaded, re-hosted, converted, extracted or sent to Whisper, so no
 * YouTube video can reach this function — there is no code path that produces a
 * local file from a YouTube id, and none is added here.
 *
 * Correspondingly, `isTranscriptEligible` refuses to embed a transcript on any
 * document whose sourceType is "youtube", regardless of what is stored in the
 * field or who owns the video.
 */
export async function transcribeAudio(localFilePath, { lang } = {}) {
    const c = getClient("Transcription");
    const resp = await c.audio.transcriptions.create({
        model: TRANSCRIBE_MODEL,
        file: fs.createReadStream(localFilePath),
        language: lang,
        response_format: "verbose_json",
    });
    return { text: resp.text, language: resp.language, segments: resp.segments };
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

export async function translateText(text, targetLang = "en") {
    return chatComplete({
        system: `Translate the user's text to ${targetLang}. Preserve tone. Output only the translation.`,
        user: text,
        temperature: 0.2,
    });
}
