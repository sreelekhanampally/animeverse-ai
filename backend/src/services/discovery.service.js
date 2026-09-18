import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import { ApiError } from "../utils/ApiError.js";
import { cosineSimilarity, isSearchableEmbedding } from "./embedding.service.js";
import { semanticVideoSearch } from "./semanticSearch.service.js";
import {
    combineSimilarityScore,
    explainSimilarityMatch,
    overlapRatio,
} from "../utils/discoveryExplain.js";

const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingTextHash +embeddingGeneratedAt";

const VIDEO_FIELDS =
    "title description thumbnail views duration owner tags category createdAt sourceType externalVideoId anime isPublished";

const ANIME_FIELDS =
    "title description genres studios characters format status season seasonYear coverImage bannerImage";

const idOf = (value) => String(value?._id || value || "");

const stripEmbedding = (doc) => {
    if (!doc) return doc;
    const copy = { ...doc };
    delete copy.embedding;
    delete copy.embeddingModel;
    delete copy.embeddingDimensions;
    delete copy.embeddingVersion;
    delete copy.embeddingGeneratedAt;
    delete copy.embeddingTextHash;
    copy.sourceType = copy.sourceType || "cloudinary";
    return copy;
};

const publicVideoQuery = (query) =>
    query
        .select(`${EMBEDDING_FIELDS} ${VIDEO_FIELDS}`)
        .populate("owner", "username fullName avatar verified isVerified")
        .populate("anime", ANIME_FIELDS);

export async function findSimilarVideos(videoId, { limit = 12, maxCandidates = 1500 } = {}) {
    if (!mongoose.isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");

    const source = await publicVideoQuery(Video.findOne({ _id: videoId, isPublished: true })).lean();
    if (!source) throw new ApiError(404, "Video not found");
    if (!isSearchableEmbedding(source)) {
        throw new ApiError(409, "This video does not have a compatible semantic embedding yet");
    }

    const candidates = await publicVideoQuery(
        Video.find({ isPublished: true, _id: { $ne: source._id } }).limit(maxCandidates)
    ).lean();

    const sourceAnimeId = idOf(source.anime);
    const ranked = [];

    for (const candidate of candidates) {
        if (!isSearchableEmbedding(candidate)) continue;
        const semantic = cosineSimilarity(source.embedding, candidate.embedding);
        if (semantic === null) continue;

        const sameAnime = sourceAnimeId && sourceAnimeId === idOf(candidate.anime) ? 1 : 0;
        const genreOverlap = overlapRatio(source.anime?.genres, candidate.anime?.genres);
        const tagOverlap = overlapRatio(source.tags, candidate.tags);
        const sameCategory =
            source.category &&
            candidate.category &&
            source.category !== "General" &&
            source.category === candidate.category
                ? 1
                : 0;
        const metadataOverlap = Math.max(tagOverlap, sameCategory);
        const score = combineSimilarityScore({ semantic, sameAnime, genreOverlap, metadataOverlap });

        const safeCandidate = stripEmbedding(candidate);
        ranked.push({
            video: safeCandidate,
            score,
            semanticScore: Number(Math.max(-1, Math.min(1, semantic)).toFixed(6)),
            sameAnime: Boolean(sameAnime),
            genreOverlap,
            metadataOverlap,
            reasons: explainSimilarityMatch(source, safeCandidate, semantic),
        });
    }

    ranked.sort((a, b) => b.score - a.score || String(a.video?._id).localeCompare(String(b.video?._id)));

    return {
        source: stripEmbedding(source),
        results: ranked.slice(0, limit),
        diagnostics: {
            candidateVideos: candidates.length,
            searchableVideos: ranked.length,
        },
    };
}

export async function buildSemanticCollection(prompt, { limit = 18 } = {}) {
    const query = String(prompt || "").trim();
    if (query.length < 2 || query.length > 240) {
        throw new ApiError(400, "Collection prompt must be between 2 and 240 characters");
    }

    const { results, diagnostics } = await semanticVideoSearch(query, { limit, maxCandidates: 1500 });
    return {
        prompt: query,
        title: query.length > 64 ? `${query.slice(0, 61).trim()}…` : query,
        description: "Matched from the AnimeVerse catalog.",
        results,
        diagnostics,
    };
}

export async function buildDiscoveryGraph(videoId, { limit = 10 } = {}) {
    const payload = await findSimilarVideos(videoId, { limit, maxCandidates: 1500 });
    const sourceId = idOf(payload.source);
    const nodes = [
        {
            id: sourceId,
            video: payload.source,
            score: 1,
            isSource: true,
            reasons: ["Current video"],
        },
        ...payload.results.map((item) => ({
            id: idOf(item.video),
            video: item.video,
            score: item.score,
            isSource: false,
            reasons: item.reasons,
        })),
    ];

    const edges = payload.results.map((item) => ({
        source: sourceId,
        target: idOf(item.video),
        weight: item.score,
        reasons: item.reasons,
    }));

    return { nodes, edges };
}
