import { randomUUID } from "node:crypto";
import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";
import { RagChunk } from "../models/ragChunk.model.js";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    generateEmbedding,
    isSearchableEmbedding,
    warmEmbeddingProvider,
} from "./embedding.service.js";
import {
    RAG_INDEX_VERSION,
    buildAnimeRagChunks,
    buildVideoRagChunks,
} from "../utils/ragChunking.js";
import { logger } from "../utils/logger.js";

const positiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const concurrency = () => Math.min(8, positiveInt(process.env.RAG_INDEX_CONCURRENCY, 2));

const chunkKey = (chunk) =>
    [chunk.sourceType, String(chunk.sourceId), chunk.chunkIndex, chunk.indexVersion].join(":");

const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;

    const run = async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
};

const desiredChunks = async () => {
    const [animeDocs, videos] = await Promise.all([
        Anime.find({}).lean(),
        Video.find({ isPublished: true })
            .populate(
                "anime",
                "title description genres studios characters format status season seasonYear metadataSource"
            )
            .lean(),
    ]);

    const chunks = [];
    for (const anime of animeDocs) chunks.push(...buildAnimeRagChunks(anime));
    for (const video of videos) {
        const linkedAnime = video?.anime && video.anime?.title ? video.anime : null;
        chunks.push(...buildVideoRagChunks(video, linkedAnime));
    }

    return {
        chunks,
        sourceCounts: {
            anime: animeDocs.length,
            videos: videos.length,
        },
    };
};

const existingChunkMap = async () => {
    const rows = await RagChunk.find({ indexVersion: RAG_INDEX_VERSION })
        .select(
            "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingGeneratedAt +embeddingTextHash sourceType sourceId chunkIndex indexVersion contentHash"
        )
        .lean();

    return new Map(rows.map((row) => [chunkKey(row), row]));
};

export async function rebuildRagIndex({ dryRun = false } = {}) {
    const startedAt = Date.now();
    const runId = randomUUID();
    const { chunks, sourceCounts } = await desiredChunks();

    const summary = {
        runId,
        dryRun,
        indexVersion: RAG_INDEX_VERSION,
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimensions: EMBEDDING_DIMENSIONS,
        embeddingVersion: EMBEDDING_VERSION,
        animeDocuments: sourceCounts.anime,
        publishedVideos: sourceCounts.videos,
        desiredChunks: chunks.length,
        unchanged: 0,
        embedded: 0,
        failed: 0,
        removedStale: 0,
        bySourceType: {},
        durationMs: 0,
    };

    for (const chunk of chunks) {
        summary.bySourceType[chunk.sourceType] =
            (summary.bySourceType[chunk.sourceType] || 0) + 1;
    }

    if (dryRun) {
        summary.durationMs = Date.now() - startedAt;
        return summary;
    }

    await warmEmbeddingProvider();
    const existing = await existingChunkMap();

    await mapWithConcurrency(chunks, concurrency(), async (chunk, index) => {
        const key = chunkKey(chunk);
        const old = existing.get(key);

        try {
            if (old?.contentHash === chunk.contentHash && isSearchableEmbedding(old)) {
                summary.unchanged += 1;
                await RagChunk.updateOne(
                    { _id: old._id },
                    {
                        $set: {
                            title: chunk.title,
                            metadata: chunk.metadata,
                            chunkCount: chunk.chunkCount,
                            anime: chunk.anime || null,
                            video: chunk.video || null,
                            indexRunId: runId,
                        },
                    }
                );
            } else {
                const embeddingFields = await generateEmbedding(chunk.content);
                await RagChunk.updateOne(
                    {
                        sourceType: chunk.sourceType,
                        sourceId: chunk.sourceId,
                        chunkIndex: chunk.chunkIndex,
                        indexVersion: chunk.indexVersion,
                    },
                    {
                        $set: {
                            ...chunk,
                            indexRunId: runId,
                            ...embeddingFields,
                        },
                    },
                    { upsert: true }
                );
                summary.embedded += 1;
            }

            if ((index + 1) % 100 === 0 || index + 1 === chunks.length) {
                logger.info("rag_index_progress", {
                    runId,
                    processed: index + 1,
                    total: chunks.length,
                    embedded: summary.embedded,
                    unchanged: summary.unchanged,
                    failed: summary.failed,
                });
            }
        } catch (error) {
            summary.failed += 1;
            logger.error("rag_index_chunk_failed", {
                runId,
                sourceType: chunk.sourceType,
                sourceId: String(chunk.sourceId),
                chunkIndex: chunk.chunkIndex,
                error,
            });
        }
    });

    if (summary.failed === 0) {
        const removed = await RagChunk.deleteMany({
            indexVersion: RAG_INDEX_VERSION,
            indexRunId: { $ne: runId },
        });
        summary.removedStale = removed.deletedCount || 0;
    } else {
        logger.warn("rag_index_cleanup_skipped", {
            runId,
            failed: summary.failed,
            reason: "stale chunks are kept when any indexing operation fails",
        });
    }

    summary.durationMs = Date.now() - startedAt;
    logger.info("rag_index_complete", summary);
    return summary;
}

export const ragIndexInternals = {
    positiveInt,
    chunkKey,
    mapWithConcurrency,
};
