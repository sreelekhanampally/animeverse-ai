import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_PROVIDER,
    EMBEDDING_VERSION,
    isEmbeddingProviderReady,
} from "./embedding.service.js";
import { semanticVideoSearch } from "./semanticSearch.service.js";
import { describeChatProvider } from "./animeAssistant.service.js";
import {
    getAiObservabilitySnapshot,
    setLastBenchmark,
} from "./aiObservability.service.js";

export const EVALUATION_BENCHMARKS = Object.freeze([
    {
        id: "fma-alchemy",
        query: "alchemy two brothers restoring their bodies",
        expected: "Fullmetal Alchemist: Brotherhood",
        aliases: ["Fullmetal Alchemist Brotherhood", "Fullmetal Alchemist: Brotherhood"],
    },
    {
        id: "one-piece-pirates",
        query: "pirate crew sailing to find treasure",
        expected: "ONE PIECE",
        aliases: ["One Piece", "ONE PIECE"],
    },
    {
        id: "aot-walls",
        query: "giant humanoid monsters attacking a walled city",
        expected: "Attack on Titan",
        aliases: ["Attack on Titan", "Shingeki no Kyojin"],
    },
    {
        id: "haikyu-volleyball",
        query: "high school volleyball team competition",
        expected: "HAIKYU!!",
        aliases: ["Haikyu", "Haikyuu", "HAIKYU!!"],
    },
    {
        id: "steins-time-travel",
        query: "time travel experiments gone wrong",
        expected: "Steins;Gate",
        aliases: ["Steins Gate", "Steins;Gate"],
    },
    {
        id: "death-note-notebook",
        query: "deadly notebook shinigami and genius detective",
        expected: "Death Note",
        aliases: ["Death Note"],
    },
    {
        id: "jjk-cursed-energy",
        query: "cursed energy sorcerers Gojo",
        expected: "Jujutsu Kaisen",
        aliases: ["Jujutsu Kaisen"],
    },
    {
        id: "demon-slayer-sister",
        query: "boy fights demons after his sister becomes a demon",
        expected: "Demon Slayer",
        aliases: ["Demon Slayer", "Kimetsu no Yaiba"],
    },
]);

const normalize = (value) =>
    String(value || "")
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

const animeTitles = (anime) =>
    [anime?.title?.display, anime?.title?.english, anime?.title?.romaji, anime?.title?.native]
        .filter(Boolean)
        .map(normalize);

const resultAnimeTitles = (result) => animeTitles(result?.video?.anime);

const matchesExpected = (result, aliases) => {
    const resultTitles = resultAnimeTitles(result);
    const expected = aliases.map(normalize);
    return resultTitles.some((title) =>
        expected.some((alias) => title === alias || title.includes(alias) || alias.includes(title))
    );
};

const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return Number(sorted[index].toFixed(1));
};

export function calculateBenchmarkMetrics(rows) {
    const eligible = rows.filter((row) => row.available && !row.error);
    if (!eligible.length) {
        return { eligibleQueries: 0, top1Accuracy: null, recallAt5: null, mrr: null, p50Ms: null, p95Ms: null };
    }

    const top1 = eligible.filter((row) => row.rank === 1).length;
    const top5 = eligible.filter((row) => row.rank && row.rank <= 5).length;
    const reciprocalRank = eligible.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0);
    const latencies = eligible.map((row) => row.latencyMs).filter(Number.isFinite);

    return {
        eligibleQueries: eligible.length,
        top1Accuracy: Number(((top1 / eligible.length) * 100).toFixed(1)),
        recallAt5: Number(((top5 / eligible.length) * 100).toFixed(1)),
        mrr: Number((reciprocalRank / eligible.length).toFixed(3)),
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
    };
}

const compatibleEmbeddingFilter = {
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingVersion: EMBEDDING_VERSION,
    [`embedding.${EMBEDDING_DIMENSIONS - 1}`]: { $exists: true },
    [`embedding.${EMBEDDING_DIMENSIONS}`]: { $exists: false },
};

async function catalogueSnapshot() {
    const [
        publishedVideos,
        embeddedVideos,
        animeCount,
        embeddedAnime,
        videoSources,
        metadataSources,
    ] = await Promise.all([
        Video.countDocuments({ isPublished: true }),
        Video.countDocuments({ isPublished: true, ...compatibleEmbeddingFilter }),
        Anime.countDocuments({}),
        Anime.countDocuments(compatibleEmbeddingFilter),
        Video.aggregate([
            { $match: { isPublished: true } },
            { $group: { _id: { $ifNull: ["$sourceType", "cloudinary"] }, count: { $sum: 1 } } },
        ]),
        Anime.aggregate([
            { $group: { _id: { $ifNull: ["$metadataSource", "anilist"] }, count: { $sum: 1 } } },
        ]),
    ]);

    return {
        videos: {
            published: publishedVideos,
            embedded: embeddedVideos,
            coverage: publishedVideos ? Number(((embeddedVideos / publishedVideos) * 100).toFixed(1)) : 0,
            bySource: Object.fromEntries(videoSources.map((row) => [row._id || "unknown", row.count])),
        },
        anime: {
            total: animeCount,
            embedded: embeddedAnime,
            coverage: animeCount ? Number(((embeddedAnime / animeCount) * 100).toFixed(1)) : 0,
            byMetadataSource: Object.fromEntries(metadataSources.map((row) => [row._id || "unknown", row.count])),
        },
    };
}

export async function runRetrievalBenchmark() {
    const animeDocs = await Anime.find({}).select("title").lean();
    const availableTitles = animeDocs.flatMap(animeTitles);
    const rows = [];

    for (const benchmark of EVALUATION_BENCHMARKS) {
        const normalizedAliases = benchmark.aliases.map(normalize);
        const available = availableTitles.some((title) =>
            normalizedAliases.some((alias) => title === alias || title.includes(alias) || alias.includes(title))
        );

        if (!available) {
            rows.push({
                id: benchmark.id,
                query: benchmark.query,
                expected: benchmark.expected,
                available: false,
                rank: null,
                topHit: null,
                latencyMs: null,
                error: null,
            });
            continue;
        }

        const startedAt = performance.now();
        try {
            const payload = await semanticVideoSearch(benchmark.query, { limit: 5, maxCandidates: 1500 });
            const latencyMs = Number((performance.now() - startedAt).toFixed(1));
            const rankIndex = payload.results.findIndex((result) => matchesExpected(result, benchmark.aliases));
            const topResult = payload.results[0];
            const topHit = topResult
                ? topResult.video?.anime?.title?.display ||
                  topResult.video?.anime?.title?.english ||
                  topResult.video?.title ||
                  "Untitled"
                : null;

            rows.push({
                id: benchmark.id,
                query: benchmark.query,
                expected: benchmark.expected,
                available: true,
                rank: rankIndex >= 0 ? rankIndex + 1 : null,
                topHit,
                topScore: topResult?.score ?? null,
                latencyMs,
                error: null,
            });
        } catch (error) {
            rows.push({
                id: benchmark.id,
                query: benchmark.query,
                expected: benchmark.expected,
                available: true,
                rank: null,
                topHit: null,
                latencyMs: Number((performance.now() - startedAt).toFixed(1)),
                error: String(error?.message || error).slice(0, 240),
            });
        }
    }

    const result = {
        ranAt: new Date().toISOString(),
        benchmarkCount: EVALUATION_BENCHMARKS.length,
        metrics: calculateBenchmarkMetrics(rows),
        rows,
        note: "Curated retrieval benchmark. Unavailable expected titles are excluded from accuracy metrics rather than counted as failures.",
    };
    setLastBenchmark(result);
    return result;
}

export async function getAiEvaluationSnapshot() {
    const [catalogue, runtime] = await Promise.all([
        catalogueSnapshot(),
        Promise.resolve(getAiObservabilitySnapshot()),
    ]);

    return {
        generatedAt: new Date().toISOString(),
        catalogue,
        embedding: {
            provider: EMBEDDING_PROVIDER,
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
            version: EMBEDDING_VERSION,
            loadedInProcess: isEmbeddingProviderReady(),
        },
        assistant: describeChatProvider(),
        runtime,
        benchmark: runtime.lastBenchmark,
    };
}

export const aiEvaluationInternals = { normalize, matchesExpected };
