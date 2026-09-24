import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
    ragHealthSnapshot,
    retrieveRagContext,
} from "../services/ragRetrieval.service.js";

const allowedSourceTypes = new Set([
    "anime_metadata",
    "anime_synopsis",
    "video_metadata",
    "creator_transcript",
]);

const normalizeFilters = (filters = {}) => {
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) return {};

    const sourceTypes = Array.isArray(filters.sourceTypes)
        ? filters.sourceTypes.filter((value) => allowedSourceTypes.has(value)).slice(0, 8)
        : undefined;

    const genres = Array.isArray(filters.genres)
        ? filters.genres.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12)
        : undefined;

    return {
        ...(sourceTypes?.length ? { sourceTypes } : {}),
        ...(genres?.length ? { genres } : {}),
        ...(filters.animeId ? { animeId: String(filters.animeId) } : {}),
        ...(filters.videoId ? { videoId: String(filters.videoId) } : {}),
        ...(filters.videoSourceType
            ? { videoSourceType: String(filters.videoSourceType).trim() }
            : {}),
    };
};

export const ragSearch = asyncHandler(async (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (query.length < 2) throw new ApiError(400, "query must contain at least 2 characters");
    if (query.length > 500) throw new ApiError(400, "query must be at most 500 characters");

    const requestedLimit = req.body?.limit == null ? 8 : Number(req.body.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 16) {
        throw new ApiError(400, "limit must be an integer between 1 and 16");
    }

    const result = await retrieveRagContext(query, {
        limit: requestedLimit,
        filters: normalizeFilters(req.body?.filters),
    });

    return res.json(new ApiResponse(200, result, "RAG retrieval complete"));
});

export const ragHealth = asyncHandler(async (_req, res) => {
    const snapshot = await ragHealthSnapshot();
    return res.status(snapshot.ready ? 200 : 503).json(
        new ApiResponse(snapshot.ready ? 200 : 503, snapshot, snapshot.ready ? "RAG index ready" : "RAG index not ready")
    );
});

export const ragControllerInternals = { normalizeFilters };
