import mongoose, { isValidObjectId } from "mongoose";
import { Video } from "../models/video.model.js";
import { Comment } from "../models/comment.model.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
    summarizeVideo,
    askVideo,
    embedText,
    cosineSim,
    commentSentiment,
    translateText,
    transcribeAudio,
    autoTagAndSummarize,
} from "../services/ai.service.js";

// GET /api/v1/ai/videos/:videoId/summary
export const getVideoSummary = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");

    const video = await Video.findById(videoId).select("+embedding").lean();
    if (!video) throw new ApiError(404, "Video not found");

    // Use cached summary if present unless ?refresh=1
    if (video.aiSummary && !req.query.refresh) {
        return res.json(new ApiResponse(200, { summary: video.aiSummary, cached: true }, "OK"));
    }

    const result = await summarizeVideo({
        title: video.title,
        description: video.description,
        transcript: video.transcript,
    });
    const summaryText = typeof result === "string" ? result : JSON.stringify(result);

    await Video.updateOne({ _id: videoId }, { $set: { aiSummary: summaryText } });
    return res.json(new ApiResponse(200, { summary: result, cached: false }, "OK"));
});

// POST /api/v1/ai/videos/:videoId/ask   { question }
export const askAboutVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { question } = req.body;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");
    if (!question?.trim()) throw new ApiError(400, "Question is required");

    const video = await Video.findById(videoId).lean();
    if (!video) throw new ApiError(404, "Video not found");

    const answer = await askVideo({
        title: video.title,
        transcript: video.transcript || video.description,
        question: question.trim(),
    });
    return res.json(new ApiResponse(200, { answer }, "OK"));
});

// GET /api/v1/ai/search?q=...
export const semanticSearch = asyncHandler(async (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q) throw new ApiError(400, "Query is required");

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const queryEmbedding = await embedText(q);

    // Load candidates — for scale, replace with a vector DB (Pinecone/pgvector).
    // Here we do in-memory cosine on published videos (limit 500 for safety).
    const candidates = await Video.find({ isPublished: true })
        .select("+embedding title description thumbnail views duration owner tags category createdAt")
        .populate("owner", "username fullName avatar")
        .limit(500)
        .lean();

    const scored = candidates
        .map((v) => ({
            ...v,
            score: cosineSim(queryEmbedding, v.embedding || []),
            embedding: undefined,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return res.json(new ApiResponse(200, scored, "OK"));
});

// GET /api/v1/ai/recommendations
export const recommendations = asyncHandler(async (req, res) => {
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit) || 12));

    let seedEmbedding = null;

    if (req.user?._id) {
        // Build a user taste vector from their last 10 watched videos.
        const user = await User.findById(req.user._id).select("watchHistory").lean();
        const historyIds = (user?.watchHistory || []).slice(0, 10);
        const history = await Video.find({ _id: { $in: historyIds } })
            .select("+embedding")
            .lean();
        if (history.length) {
            const dim = history[0].embedding?.length || 0;
            if (dim) {
                const vec = new Array(dim).fill(0);
                for (const h of history) {
                    if (h.embedding?.length === dim) {
                        for (let i = 0; i < dim; i++) vec[i] += h.embedding[i];
                    }
                }
                seedEmbedding = vec.map((x) => x / history.length);
            }
        }
    }

    const candidates = await Video.find({ isPublished: true })
        .select("+embedding title description thumbnail views duration owner tags category createdAt")
        .populate("owner", "username fullName avatar")
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();

    let scored;
    if (seedEmbedding) {
        scored = candidates
            .map((v) => ({
                ...v,
                score: cosineSim(seedEmbedding, v.embedding || []),
                embedding: undefined,
            }))
            .sort((a, b) => b.score - a.score);
    } else {
        // Cold start: trending mix (views + recency)
        const now = Date.now();
        scored = candidates
            .map((v) => {
                const ageDays = (now - new Date(v.createdAt).getTime()) / 86400000;
                return { ...v, score: (v.views || 0) / Math.pow(ageDays + 2, 1.2), embedding: undefined };
            })
            .sort((a, b) => b.score - a.score);
    }

    return res.json(new ApiResponse(200, scored.slice(0, limit), "OK"));
});

// GET /api/v1/ai/videos/:videoId/sentiment
export const videoCommentSentiment = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");

    const comments = await Comment.find({ video: new mongoose.Types.ObjectId(videoId) })
        .sort({ createdAt: -1 })
        .limit(100)
        .select("content")
        .lean();

    const result = await commentSentiment(comments.map((c) => c.content));
    return res.json(new ApiResponse(200, result, "OK"));
});

// POST /api/v1/ai/translate   { text, target }
export const translate = asyncHandler(async (req, res) => {
    const { text, target = "en" } = req.body;
    if (!text?.trim()) throw new ApiError(400, "text is required");
    const translation = await translateText(text, target);
    return res.json(new ApiResponse(200, { translation }, "OK"));
});

// POST /api/v1/ai/transcribe  (multipart: audio)
export const transcribe = asyncHandler(async (req, res) => {
    const file = req.file?.path;
    if (!file) throw new ApiError(400, "Audio file is required");
    const result = await transcribeAudio(file, { lang: req.body?.lang });
    return res.json(new ApiResponse(200, result, "OK"));
});

// POST /api/v1/ai/videos/:videoId/reindex  — owner-only reindex
export const reindexVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");
    const video = await Video.findById(videoId);
    if (!video) throw new ApiError(404, "Video not found");
    if (!video.owner.equals(req.user._id)) throw new ApiError(403, "Not authorized");

    const { tags, summary, category } = await autoTagAndSummarize({
        title: video.title,
        description: video.description,
    });
    const embedding = await embedText(`${video.title}\n${video.description}\n${tags.join(", ")}`);
    await Video.updateOne(
        { _id: videoId },
        { $set: { tags, category, aiSummary: summary, embedding } }
    );
    return res.json(new ApiResponse(200, { tags, category, summary }, "Reindexed"));
});

// GET /api/v1/ai/health
export const aiHealth = asyncHandler(async (req, res) => {
    return res.json(
        new ApiResponse(
            200,
            { openai: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-4o-mini" },
            "OK"
        )
    );
});
