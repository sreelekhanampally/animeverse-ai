import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";
import { RagChunk } from "../models/ragChunk.model.js";
import { RAG_INDEX_VERSION } from "../config/rag.config.js";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    generateEmbedding,
    isSearchableEmbedding,
    warmEmbeddingProvider,
} from "./embedding.service.js";
import { buildAnimeRagChunks, buildVideoRagChunks } from "../utils/ragText.js";

const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingGeneratedAt +embeddingTextHash";

const compatibleEmbeddingFilter = {
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingVersion: EMBEDDING_VERSION,
    [`embedding.${EMBEDDING_DIMENSIONS - 1}`]: { $exists: true },
    [`embedding.${EMBEDDING_DIMENSIONS}`]: { $exists: false },
};

async function buildDesiredChunks() {
    const [animeDocs, videos] = await Promise.all([
        Anime.find({})
            .select(
                "title description genres studios characters format status season seasonYear metadataSource"
            )
            .lean(),
        Video.find({ isPublished: true })
            .select(
                "title description thumbnail sourceType anime tags category transcript transcriptLang"
            )
            .populate("anime", "title genres studios season seasonYear")
            .lean(),
    ]);

    const chunks = [];
    for (const anime of animeDocs) chunks.push(...buildAnimeRagChunks(anime));
    for (const video of videos) chunks.push(...buildVideoRagChunks(video, video.anime));

    return {
        chunks,
        sourceCounts: {
            anime: animeDocs.length,
            videos: videos.length,
        },
    };
}

const flushBulk = async (operations) => {
    if (!operations.length) return;
    await RagChunk.bulkWrite(operations, { ordered: false });
    operations.length = 0;
};

export async function buildRagIndex({
    dryRun = false,
    batchSize = 25,
    prune = true,
} = {}) {
    const { chunks, sourceCounts } = await buildDesiredChunks();
    const existingRows = await RagChunk.find({})
        .select(
            `${EMBEDDING_FIELDS} chunkKey contentHash indexVersion isActive sourceType sourceId`
        )
        .lean();
    const existingByKey = new Map(existingRows.map((row) => [row.chunkKey, row]));
    const desiredKeys = chunks.map((chunk) => chunk.chunkKey);

    const stats = {
        dryRun,
        indexVersion: RAG_INDEX_VERSION,
        sourceCounts,
        desiredChunks: chunks.length,
        existingChunks: existingRows.length,
        unchanged: 0,
        reactivated: 0,
        embedded: 0,
        wouldEmbed: 0,
        deactivated: 0,
        errors: [],
    };

    if (!dryRun && chunks.length) await warmEmbeddingProvider();

    const operations = [];
    const safeBatchSize = Math.min(100, Math.max(1, Number(batchSize) || 25));

    for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const existing = existingByKey.get(chunk.chunkKey);
        const unchanged =
            existing &&
            existing.contentHash === chunk.contentHash &&
            existing.indexVersion === RAG_INDEX_VERSION &&
            isSearchableEmbedding(existing);

        if (unchanged) {
            stats.unchanged += 1;
            if (!existing.isActive) {
                stats.reactivated += 1;
                if (!dryRun) {
                    operations.push({
                        updateOne: {
                            filter: { chunkKey: chunk.chunkKey },
                            update: { $set: { isActive: true, updatedAt: new Date() } },
                        },
                    });
                }
            }
        } else if (dryRun) {
            stats.wouldEmbed += 1;
        } else {
            try {
                const embeddingFields = await generateEmbedding(chunk.text);
                const now = new Date();
                operations.push({
                    updateOne: {
                        filter: { chunkKey: chunk.chunkKey },
                        update: {
                            $set: {
                                ...chunk,
                                ...embeddingFields,
                                isActive: true,
                                updatedAt: now,
                            },
                            $setOnInsert: { createdAt: now },
                        },
                        upsert: true,
                    },
                });
                stats.embedded += 1;
            } catch (error) {
                stats.errors.push({
                    chunkKey: chunk.chunkKey,
                    message: String(error?.message || error).slice(0, 300),
                });
                if (existing) {
                    operations.push({
                        updateOne: {
                            filter: { chunkKey: chunk.chunkKey },
                            update: { $set: { isActive: false, updatedAt: new Date() } },
                        },
                    });
                }
            }
        }

        if (!dryRun && operations.length >= safeBatchSize) await flushBulk(operations);
    }

    if (!dryRun) {
        await flushBulk(operations);

        if (prune) {
            const result = desiredKeys.length
                ? await RagChunk.updateMany(
                      { isActive: true, chunkKey: { $nin: desiredKeys } },
                      { $set: { isActive: false, updatedAt: new Date() } }
                  )
                : await RagChunk.updateMany(
                      { isActive: true },
                      { $set: { isActive: false, updatedAt: new Date() } }
                  );
            stats.deactivated = result.modifiedCount || 0;
        }
    }

    return stats;
}

export async function getRagIndexStatus() {
    const [activeChunks, embeddedChunks, inactiveChunks, bySource] = await Promise.all([
        RagChunk.countDocuments({ isActive: true, indexVersion: RAG_INDEX_VERSION }),
        RagChunk.countDocuments({
            isActive: true,
            indexVersion: RAG_INDEX_VERSION,
            ...compatibleEmbeddingFilter,
        }),
        RagChunk.countDocuments({ isActive: false }),
        RagChunk.aggregate([
            { $match: { isActive: true, indexVersion: RAG_INDEX_VERSION } },
            { $group: { _id: "$sourceType", count: { $sum: 1 } } },
        ]),
    ]);

    return {
        indexVersion: RAG_INDEX_VERSION,
        activeChunks,
        embeddedChunks,
        embeddingCoverage: activeChunks
            ? Number(((embeddedChunks / activeChunks) * 100).toFixed(1))
            : 0,
        inactiveChunks,
        bySource: Object.fromEntries(bySource.map((row) => [row._id, row.count])),
        embedding: {
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
            version: EMBEDDING_VERSION,
        },
    };
}
