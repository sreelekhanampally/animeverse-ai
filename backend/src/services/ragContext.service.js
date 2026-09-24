import {
    RAG_MAX_CHUNKS_PER_SOURCE,
    RAG_MAX_CONTEXT_CHARS,
} from "../config/rag.config.js";

const safe = (value, max = 2_000) => String(value ?? "").trim().slice(0, max);

const sourceBucket = (result) =>
    `${result?.sourceCollection || "Unknown"}:${result?.sourceId || result?.chunkKey || "unknown"}`;

export function buildRagContext(
    results = [],
    {
        maxChars = RAG_MAX_CONTEXT_CHARS,
        maxChunksPerSource = RAG_MAX_CHUNKS_PER_SOURCE,
    } = {}
) {
    const counts = new Map();
    const blocks = [];
    const evidence = [];
    let usedChars = 0;

    for (const result of results) {
        if (!result?.text) continue;

        const bucket = sourceBucket(result);
        const count = counts.get(bucket) || 0;
        if (count >= maxChunksPerSource) continue;

        const citation = `AV${evidence.length + 1}`;
        const header = [
            `[${citation}] ${safe(result.sourceTitle, 220)}`,
            `Type: ${result.sourceType}`,
            `Section: ${result.section}`,
        ].join("\n");
        const block = `${header}\n${safe(result.text, 2_500)}`;

        if (usedChars + block.length > maxChars) {
            if (evidence.length) break;
            const room = Math.max(0, maxChars - header.length - 1);
            if (!room) break;
            blocks.push(`${header}\n${safe(result.text, room)}`);
            usedChars = maxChars;
        } else {
            blocks.push(block);
            usedChars += block.length;
        }

        counts.set(bucket, count + 1);
        const metadata = result.metadata || {};
        evidence.push({
            citation,
            chunkKey: result.chunkKey,
            sourceType: result.sourceType,
            sourceCollection: result.sourceCollection,
            sourceId: result.sourceId,
            title: result.sourceTitle,
            section: result.section,
            score: result.score,
            vectorScore: result.vectorScore,
            lexicalScore: result.lexicalScore,
            videoId: metadata.videoId || null,
            videoTitle: metadata.videoTitle || null,
            thumbnail: metadata.thumbnail || "",
            animeId: metadata.animeId || null,
            animeTitle: metadata.animeTitle || null,
            href: metadata.videoId ? `/watch/${metadata.videoId}` : null,
        });

        if (usedChars >= maxChars) break;
    }

    return {
        context: blocks.join("\n\n"),
        evidence,
        diagnostics: {
            suppliedResults: results.length,
            contextChunks: evidence.length,
            contextChars: usedChars,
            maxContextChars: maxChars,
        },
    };
}
