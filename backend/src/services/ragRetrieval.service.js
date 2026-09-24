import mongoose from "mongoose";
import { RagChunk } from "../models/ragChunk.model.js";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    cosineSimilarity,
    generateEmbedding,
    isSearchableEmbedding,
} from "./embedding.service.js";
import { fuseRankings, rerankRagResults } from "../utils/ragRanking.js";
import { RAG_INDEX_VERSION } from "../utils/ragChunking.js";

const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingGeneratedAt +embeddingTextHash";

const PUBLIC_FIELDS =
    "sourceType sourceId anime video title content chunkIndex chunkCount metadata contentHash indexVersion";

const clean = (value, max = 10_000) => String(value ?? "").trim().slice(0, max);

const validObjectId = (value) => {
    const text = String(value || "").trim();
    return mongoose.isValidObjectId(text) ? new mongoose.Types.ObjectId(text) : null;
};

export function buildRagFilter(filters = {}) {
    const query = { indexVersion: RAG_INDEX_VERSION };

    if (Array.isArray(filters.sourceTypes) && filters.sourceTypes.length) {
        query.sourceType = { $in: filters.sourceTypes.slice(0, 8) };
    }

    const animeId = validObjectId(filters.animeId);
    if (animeId) query.anime = animeId;

    const videoId = validObjectId(filters.videoId);
    if (videoId) query.video = videoId;

    if (filters.videoSourceType) {
        query["metadata.videoSourceType"] = clean(filters.videoSourceType, 40);
    }

    if (Array.isArray(filters.genres) && filters.genres.length) {
        query["metadata.genres"] = { $in: filters.genres.slice(0, 12).map((item) => clean(item, 80)) };
    }

    return query;
}

const vectorCandidates = async (queryEmbedding, filter, maxCandidates) => {
    const rows = await RagChunk.find(filter)
        .select(`${EMBEDDING_FIELDS} ${PUBLIC_FIELDS}`)
        .limit(maxCandidates)
        .lean();

    const scored = [];
    for (const chunk of rows) {
        if (!isSearchableEmbedding(chunk)) continue;
        const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
        if (semanticScore === null) continue;
        scored.push({ chunk, semanticScore });
    }

    scored.sort((a, b) => b.semanticScore - a.semanticScore);
    return scored.slice(0, 80);
};

const lexicalCandidates = async (query, filter) => {
    try {
        const rows = await RagChunk.find({
            ...filter,
            $text: { $search: query },
        })
            .select(PUBLIC_FIELDS)
            .select({ mongoTextScore: { $meta: "textScore" } })
            .sort({ mongoTextScore: { $meta: "textScore" } })
            .limit(80)
            .lean();

        return rows.map((chunk) => ({
            chunk,
            mongoTextScore: Number(chunk.mongoTextScore || 0),
        }));
    } catch {
        // Vector retrieval remains available while a deployment is still building
        // the Mongo text index. The lexical branch is an enhancement, not a blocker.
        return [];
    }
};

const excerpt = (content, max = 520) => {
    const text = clean(content, 5_000);
    return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
};

const publicResult = (entry, citationId) => ({
    citationId,
    sourceType: entry.chunk.sourceType,
    sourceId: String(entry.chunk.sourceId),
    animeId: entry.chunk.anime ? String(entry.chunk.anime) : null,
    videoId: entry.chunk.video ? String(entry.chunk.video) : null,
    title: entry.chunk.title,
    excerpt: excerpt(entry.chunk.content),
    chunkIndex: entry.chunk.chunkIndex,
    chunkCount: entry.chunk.chunkCount,
    metadata: entry.chunk.metadata || {},
    score: entry.score,
    semanticScore: Number(entry.semanticScore || 0),
    lexicalScore: entry.lexicalScore,
    retrieval: {
        vectorRank: entry.vectorRank,
        lexicalRank: entry.lexicalRank,
        rrfScore: Number(entry.rrfScore.toFixed(8)),
    },
});

export function buildRagContext(results = [], { maxChars = 7_000, maxPerSource = 2 } = {}) {
    const selected = [];
    const counts = new Map();
    let usedChars = 0;

    for (const result of results) {
        const sourceKey = `${result.sourceType}:${result.sourceId}`;
        const count = counts.get(sourceKey) || 0;
        if (count >= maxPerSource) continue;

        const block = [
            `[${result.citationId}] ${result.title}`,
            `Source: ${result.sourceType}`,
            result.excerpt,
        ]
            .filter(Boolean)
            .join("\n");

        if (selected.length && usedChars + block.length > maxChars) break;
        if (!selected.length && block.length > maxChars) {
            selected.push(block.slice(0, maxChars));
            break;
        }

        selected.push(block);
        usedChars += block.length;
        counts.set(sourceKey, count + 1);
    }

    return selected.join("\n\n");
}

export async function retrieveRagContext(
    query,
    {
        limit = 8,
        maxCandidates = 6_000,
        filters = {},
        maxContextChars = 7_000,
    } = {}
) {
    const normalizedQuery = clean(query, 500);
    if (normalizedQuery.length < 2) {
        const error = new Error("RAG query must contain at least 2 characters");
        error.statusCode = 400;
        throw error;
    }

    const safeLimit = Math.min(16, Math.max(1, Number(limit) || 8));
    const filter = buildRagFilter(filters);
    const { embedding: queryEmbedding } = await generateEmbedding(normalizedQuery);

    const [vector, lexical] = await Promise.all([
        vectorCandidates(queryEmbedding, filter, Math.min(10_000, Math.max(100, maxCandidates))),
        lexicalCandidates(normalizedQuery, filter),
    ]);

    const fused = fuseRankings(vector, lexical);
    const reranked = rerankRagResults(normalizedQuery, fused);

    // Keep the context diverse: no single source document may monopolize the top
    // results just because its synopsis/transcript produced several adjacent chunks.
    const selected = [];
    const perSource = new Map();
    for (const entry of reranked) {
        const sourceKey = `${entry.chunk.sourceType}:${entry.chunk.sourceId}`;
        const count = perSource.get(sourceKey) || 0;
        if (count >= 2) continue;
        selected.push(entry);
        perSource.set(sourceKey, count + 1);
        if (selected.length >= safeLimit) break;
    }

    const sources = selected.map((entry, index) => publicResult(entry, `AV${index + 1}`));
    const context = buildRagContext(sources, { maxChars: maxContextChars, maxPerSource: 2 });

    return {
        query: normalizedQuery,
        context,
        sources,
        diagnostics: {
            indexVersion: RAG_INDEX_VERSION,
            embeddingModel: EMBEDDING_MODEL,
            vectorCandidates: vector.length,
            lexicalCandidates: lexical.length,
            fusedCandidates: fused.length,
            returned: sources.length,
            filtersApplied: Object.keys(filter).filter((key) => key !== "indexVersion"),
        },
    };
}

export async function ragHealthSnapshot() {
    const expectedEmbedding = {
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimensions: EMBEDDING_DIMENSIONS,
        embeddingVersion: EMBEDDING_VERSION,
        indexVersion: RAG_INDEX_VERSION,
    };

    const [total, searchable, grouped] = await Promise.all([
        RagChunk.countDocuments({ indexVersion: RAG_INDEX_VERSION }),
        RagChunk.countDocuments(expectedEmbedding),
        RagChunk.aggregate([
            { $match: { indexVersion: RAG_INDEX_VERSION } },
            { $group: { _id: "$sourceType", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
    ]);

    return {
        indexVersion: RAG_INDEX_VERSION,
        totalChunks: total,
        searchableChunks: searchable,
        coveragePercent: total ? Number(((searchable / total) * 100).toFixed(1)) : 0,
        embedding: {
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
            version: EMBEDDING_VERSION,
        },
        bySourceType: Object.fromEntries(grouped.map((row) => [row._id, row.count])),
        ready: total > 0 && searchable === total,
    };
}

export const ragRetrievalInternals = {
    vectorCandidates,
    lexicalCandidates,
    publicResult,
    excerpt,
};
