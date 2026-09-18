import mongoose, { isValidObjectId } from "mongoose";
import { Video } from "../models/video.model.js";
import { Comment } from "../models/comment.model.js";
import { User } from "../models/user.model.js";
import { Like } from "../models/like.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildVideoEmbeddingText } from "../utils/embeddingText.js";
import { semanticVideoSearch } from "../services/semanticSearch.service.js";
import {
    buildDiscoveryGraph,
    buildSemanticCollection,
    findSimilarVideos,
} from "../services/discovery.service.js";
import { answerAnimeChat, describeChatProvider } from "../services/animeAssistant.service.js";
import { getAiEvaluationSnapshot, runRetrievalBenchmark } from "../services/aiEvaluation.service.js";
import { recordAiOperation } from "../services/aiObservability.service.js";
import {
    summarizeVideo,
    askVideo,
    commentSentiment,
    translateText,
    transcribeAudio,
    autoTagAndSummarize,
    cosineSimilarity,
    describeEmbeddingState,
    embeddingStatus,
    generateEmbedding,
    hasEmbeddingProvider,
    hasOpenAIKey,
    isSearchableEmbedding,
} from "../services/ai.service.js";

/**
 * Session 1.5 scope note — WHY THE GUARDS CHANGED SHAPE.
 *
 * Session 1 gated every route in this file on `hasEmbeddingProvider()`. That was
 * correct while embeddings were the only thing OPENAI_API_KEY bought: one key, one
 * question.
 *
 * Embeddings are now produced locally and free, so `hasEmbeddingProvider()` is
 * unconditionally true. Left alone, every route below — summaries, ask, sentiment,
 * translate, transcribe — would have started announcing itself as available on a
 * deployment with no credits, accepted the request, and failed inside the OpenAI
 * SDK with a 429 instead of the honest 503 it returns today.
 *
 * So each route now gates on the capability it actually consumes:
 *
 *   hasOpenAIKey()          — chat, summary, tagging, sentiment, translation,
 *                             transcription. Still needs credits.
 *   hasEmbeddingProvider()  — the vector paths. Now always satisfiable locally.
 *
 * Nothing else here changed: same paths, same methods, same response envelopes,
 * same 503 shape. Only the condition each guard tests. Scene-search and /ai/chat
 * remain Session 2 work and are not added here.
 *
 * Session 1 scope note (still accurate).
 *
 * Every route this file backed before is still here with the same path, method and
 * response envelope — nothing was removed and no new endpoint was added. The new
 * scene-search and chat endpoints belong to Session 2.
 *
 * What did change is that the vector paths no longer pretend to work. Previously
 * `semanticSearch` embedded the query with a fabricated 32-float vector when no API
 * key was configured, scored it against whatever was stored, and returned a
 * confident 200 whose ordering was arbitrary. Because `cosineSim` returned 0 for
 * mismatched lengths, a legacy 32-float document and a real 1536-float one both
 * scored 0 and sorted indistinguishably from genuinely unrelated content.
 *
 * Now: no key means an explicit 503, and a stored vector is scored only when its
 * model, dimensions and version all match the active configuration.
 */

/**
 * The embedding metadata is select:false on the schema, so validating a vector
 * requires asking for it. Grouped here so no call site can select the vector while
 * forgetting the provenance that decides whether it may be used.
 */
const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingTextHash +embeddingGeneratedAt";

/**
 * Strips every embedding field from a lean document before it is serialised.
 *
 * `delete` rather than `= undefined`: JSON.stringify does drop undefined values, but
 * anything that inspects the object before serialisation (a later spread, a log
 * line, a test assertion on Object.keys) would still see the key and the 30KB
 * array behind it. Deleting is unambiguous.
 */
const stripEmbedding = (doc) => {
    delete doc.embedding;
    delete doc.embeddingModel;
    delete doc.embeddingDimensions;
    delete doc.embeddingVersion;
    delete doc.embeddingGeneratedAt;
    delete doc.embeddingTextHash;
    return doc;
};

/**
 * The single "AI is not configured" response shape.
 *
 * 503 with success:false and a machine-readable `code`, so a client can tell this
 * apart from an empty result set. Returned rather than thrown for the search and
 * recommendation paths, because a browsing UI should degrade visibly, not error.
 */
const respondUnavailable = (res, message) =>
    res.status(503).json({
        statusCode: 503,
        success: false,
        code: "AI_NOT_CONFIGURED",
        message,
        errors: [],
        data: null,
    });

// GET /api/v1/ai/videos/:videoId/summary
export const getVideoSummary = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");

    // No longer selects +embedding: a summary has never used the vector, and
    // pulling 1536 floats per request was pure overhead.
    const video = await Video.findById(videoId).lean();
    if (!video) throw new ApiError(404, "Video not found");

    // A cached summary is still served without a key — it was generated by a real
    // model at some point, so returning it is honest and costs nothing.
    if (video.aiSummary && !req.query.refresh) {
        return res.json(new ApiResponse(200, { summary: video.aiSummary, cached: true }, "OK"));
    }

    // Summaries are generated by the chat model, which still needs credits — the
    // local embedding provider does not make this route available.
    if (!hasOpenAIKey()) {
        return respondUnavailable(res, "Summaries require OPENAI_API_KEY to be configured.");
    }

    const result = await summarizeVideo({
        title: video.title,
        description: video.description,
        // A YouTube video's transcript field is never trusted here for the same
        // reason it is excluded from embeddings: we are not permitted to have
        // produced one, so anything stored there is of unknown origin.
        transcript: video.sourceType === "youtube" ? "" : video.transcript,
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

    if (!hasOpenAIKey()) {
        return respondUnavailable(res, "Asking about a video requires OPENAI_API_KEY to be configured.");
    }

    const video = await Video.findById(videoId).lean();
    if (!video) throw new ApiError(404, "Video not found");

    const transcript = video.sourceType === "youtube" ? "" : video.transcript;

    const answer = await askVideo({
        title: video.title,
        transcript: transcript || video.description,
        question: question.trim(),
    });
    return res.json(new ApiResponse(200, { answer }, "OK"));
});

const parseSearchInput = (query, rawLimit) => {
    const q = String(query || "").trim();
    if (q.length < 2 || q.length > 300) {
        throw new ApiError(400, "Query must be between 2 and 300 characters");
    }

    const parsedLimit = rawLimit == null ? 20 : Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
        throw new ApiError(400, "limit must be an integer between 1 and 20");
    }

    return { q, limit: parsedLimit };
};

const runSemanticSearch = async (q, limit) => {
    if (!hasEmbeddingProvider()) {
        return null;
    }

    const startedAt = performance.now();
    try {
        const payload = await semanticVideoSearch(q, { limit });
        recordAiOperation("semanticSearch", {
            durationMs: performance.now() - startedAt,
            success: true,
        });
        return payload;
    } catch (error) {
        recordAiOperation("semanticSearch", {
            durationMs: performance.now() - startedAt,
            success: false,
            errorCode: error?.code || error?.name || "SEARCH_ERROR",
        });
        throw error;
    }
};

// GET /api/v1/ai/search?q=...
// Backward-compatible semantic search endpoint used by existing clients.
export const semanticSearch = asyncHandler(async (req, res) => {
    const { q, limit } = parseSearchInput(req.query.q, req.query.limit);
    const payload = await runSemanticSearch(q, limit);

    if (!payload) {
        return respondUnavailable(res, "The local embedding provider is unavailable.");
    }

    const skipped = payload.diagnostics.skippedVideos;
    return res.json(
        new ApiResponse(
            200,
            payload.results,
            skipped
                ? `OK — ${skipped} video(s) skipped because their embeddings are stale or invalid.`
                : "OK"
        )
    );
});

// POST /api/v1/ai/semantic-search  { query, limit }
// Truthfully named API for the Session 2 UI. This is metadata-level semantic
// discovery, not timestamp/scene retrieval.
export const semanticSearchPost = asyncHandler(async (req, res) => {
    const { q, limit } = parseSearchInput(req.body?.query, req.body?.limit ?? 12);
    const payload = await runSemanticSearch(q, limit);

    if (!payload) {
        return respondUnavailable(res, "The local embedding provider is unavailable.");
    }

    return res.json(
        new ApiResponse(
            200,
            { query: q, results: payload.results, diagnostics: payload.diagnostics },
            "Semantic search complete"
        )
    );
});

// POST /api/v1/ai/chat  { messages: [{ role, content }] }
// Dedicated anime assistant. Gemini free-tier is preferred when configured and can
// call AnimeVerse catalogue tools on demand. Ollama/local retrieval remain free fallbacks.
export const animeChat = asyncHandler(async (req, res) => {
    const messages = req.body?.messages;
    const startedAt = performance.now();
    try {
        const result = await answerAnimeChat(messages);
        recordAiOperation("chat", {
            durationMs: performance.now() - startedAt,
            success: true,
            provider: result.provider,
            toolCalls: result.toolCalls || 0,
            usedCatalog: Boolean(result.usedCatalog),
        });
        return res.json(new ApiResponse(200, result, "AnimeVerse assistant response"));
    } catch (error) {
        recordAiOperation("chat", {
            durationMs: performance.now() - startedAt,
            success: false,
            errorCode: error?.code || error?.name || "CHAT_ERROR",
        });
        throw error;
    }
});

// GET /api/v1/ai/videos/:videoId/similar
export const similarVideos = asyncHandler(async (req, res) => {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 12));
    const startedAt = performance.now();
    try {
        const payload = await findSimilarVideos(req.params.videoId, { limit });
        recordAiOperation("similarVideos", { durationMs: performance.now() - startedAt, success: true });
        return res.json(new ApiResponse(200, payload, "Similar videos ready"));
    } catch (error) {
        recordAiOperation("similarVideos", {
            durationMs: performance.now() - startedAt,
            success: false,
            errorCode: error?.code || error?.name || "SIMILAR_ERROR",
        });
        throw error;
    }
});

// GET /api/v1/ai/videos/:videoId/graph
export const discoveryGraph = asyncHandler(async (req, res) => {
    const limit = Math.min(16, Math.max(4, parseInt(req.query.limit) || 10));
    const startedAt = performance.now();
    try {
        const payload = await buildDiscoveryGraph(req.params.videoId, { limit });
        recordAiOperation("discoveryGraph", { durationMs: performance.now() - startedAt, success: true });
        return res.json(new ApiResponse(200, payload, "Semantic discovery graph ready"));
    } catch (error) {
        recordAiOperation("discoveryGraph", {
            durationMs: performance.now() - startedAt,
            success: false,
            errorCode: error?.code || error?.name || "GRAPH_ERROR",
        });
        throw error;
    }
});

// POST /api/v1/ai/collections  { prompt, limit }
export const semanticCollection = asyncHandler(async (req, res) => {
    const rawLimit = req.body?.limit == null ? 18 : Number(req.body.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 4 || rawLimit > 24) {
        throw new ApiError(400, "limit must be an integer between 4 and 24");
    }

    const startedAt = performance.now();
    try {
        const payload = await buildSemanticCollection(req.body?.prompt, { limit: rawLimit });
        recordAiOperation("collections", { durationMs: performance.now() - startedAt, success: true });
        return res.json(new ApiResponse(200, payload, "Dynamic collection ready"));
    } catch (error) {
        recordAiOperation("collections", {
            durationMs: performance.now() - startedAt,
            success: false,
            errorCode: error?.code || error?.name || "COLLECTION_ERROR",
        });
        throw error;
    }
});

// GET /api/v1/ai/evaluation
// Sanitized system snapshot for the recruiter-facing AI Evaluation Lab. No keys,
// embeddings, prompts or private user data are returned. Runtime metrics reset on restart.
export const aiEvaluation = asyncHandler(async (_req, res) => {
    const snapshot = await getAiEvaluationSnapshot();
    return res.json(new ApiResponse(200, snapshot, "AI evaluation snapshot"));
});

// POST /api/v1/ai/evaluation/run
// Runs a small deterministic local retrieval benchmark. This is intentionally
// manual + aggressively rate-limited because it performs several embedding/search passes.
export const runAiEvaluation = asyncHandler(async (_req, res) => {
    const benchmark = await runRetrievalBenchmark();
    const snapshot = await getAiEvaluationSnapshot();
    return res.json(
        new ApiResponse(200, { ...snapshot, benchmark }, "AI retrieval benchmark complete")
    );
});

const weightedCentroid = (entries = []) => {
    const usable = entries.filter((entry) => isSearchableEmbedding(entry.video) && entry.weight > 0);
    if (!usable.length) return null;
    const dim = usable[0].video.embedding.length;
    const vec = new Array(dim).fill(0);
    let totalWeight = 0;
    for (const { video, weight } of usable) {
        if (video.embedding.length !== dim) continue;
        totalWeight += weight;
        for (let i = 0; i < dim; i += 1) vec[i] += video.embedding[i] * weight;
    }
    if (!totalWeight) return null;
    return vec.map((value) => value / totalWeight);
};

// GET /api/v1/ai/recommendations
export const recommendations = asyncHandler(async (req, res) => {
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit) || 12));

    let seedEmbedding = null;
    const signalCentroids = {};
    const recentHistoryIds = [];

    if (req.user?._id && hasEmbeddingProvider()) {
        const [user, likes] = await Promise.all([
            User.findById(req.user._id).select("watchHistory watchLater").lean(),
            Like.find({ likedBy: req.user._id, video: { $exists: true, $ne: null } })
                .sort({ createdAt: -1 })
                .limit(20)
                .select("video")
                .lean(),
        ]);

        const historyIds = (user?.watchHistory || []).slice(0, 12);
        recentHistoryIds.push(...historyIds.map(String));
        const watchLaterIds = (user?.watchLater || []).slice(0, 12);
        const likedIds = likes.map((item) => item.video).filter(Boolean).slice(0, 16);

        const allIds = [...new Set([...historyIds, ...watchLaterIds, ...likedIds].map(String))];
        if (allIds.length) {
            const seedVideos = await Video.find({ _id: { $in: allIds } })
                .select(`${EMBEDDING_FIELDS} title`)
                .lean();
            const byId = new Map(seedVideos.map((video) => [String(video._id), video]));

            const historyEntries = historyIds
                .map((id, index) => ({ video: byId.get(String(id)), weight: Math.max(0.55, 1 - index * 0.04) }))
                .filter((entry) => entry.video);
            const likedEntries = likedIds
                .map((id) => ({ video: byId.get(String(id)), weight: 1.35 }))
                .filter((entry) => entry.video);
            const watchLaterEntries = watchLaterIds
                .map((id) => ({ video: byId.get(String(id)), weight: 0.85 }))
                .filter((entry) => entry.video);

            signalCentroids.history = weightedCentroid(historyEntries);
            signalCentroids.likes = weightedCentroid(likedEntries);
            signalCentroids.watchLater = weightedCentroid(watchLaterEntries);
            seedEmbedding = weightedCentroid([
                ...historyEntries,
                ...likedEntries,
                ...watchLaterEntries,
            ]);
        }
    }

    const candidateFilter = { isPublished: true };
    if (recentHistoryIds.length) candidateFilter._id = { $nin: recentHistoryIds };

    const candidates = await Video.find(candidateFilter)
        .select(`${EMBEDDING_FIELDS} title description thumbnail views duration owner tags category createdAt sourceType externalVideoId`)
        .populate("owner", "username fullName avatar")
        .sort({ createdAt: -1 })
        .limit(1500)
        .lean();

    let scored;
    if (seedEmbedding) {
        const labels = {
            likes: "Similar to videos you liked",
            history: "Close to your recent watch history",
            watchLater: "Matches videos you saved for later",
        };
        scored = [];
        for (const video of candidates) {
            if (!isSearchableEmbedding(video)) continue;
            const score = cosineSimilarity(seedEmbedding, video.embedding);
            if (score === null) continue;

            const groupScores = Object.entries(signalCentroids)
                .filter(([, centroid]) => centroid)
                .map(([key, centroid]) => [key, cosineSimilarity(centroid, video.embedding)])
                .filter(([, value]) => value !== null)
                .sort((a, b) => b[1] - a[1]);
            const strongestSignal = groupScores[0]?.[0];
            scored.push({
                ...stripEmbedding(video),
                score,
                recommendation: {
                    mode: "personalized",
                    score: Number(Math.max(0, score).toFixed(6)),
                    reasons: strongestSignal ? [labels[strongestSignal]] : ["Matches your AnimeVerse activity"],
                },
            });
        }
        scored.sort((a, b) => b.score - a.score);
        if (!scored.length) seedEmbedding = null;
    }

    if (!seedEmbedding) {
        const now = Date.now();
        scored = candidates
            .map((video) => {
                const ageDays = (now - new Date(video.createdAt).getTime()) / 86400000;
                return {
                    ...stripEmbedding(video),
                    score: (video.views || 0) / Math.pow(ageDays + 2, 1.2),
                    recommendation: {
                        mode: "popular",
                        reasons: ["Popular + recently added on AnimeVerse"],
                    },
                };
            })
            .sort((a, b) => b.score - a.score);
    }

    return res.json(new ApiResponse(200, scored.slice(0, limit), "OK"));
});

// GET /api/v1/ai/videos/:videoId/sentiment
export const videoCommentSentiment = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");

    if (!hasOpenAIKey()) {
        return respondUnavailable(res, "Sentiment analysis requires OPENAI_API_KEY to be configured.");
    }

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

    if (!hasOpenAIKey()) {
        return respondUnavailable(res, "Translation requires OPENAI_API_KEY to be configured.");
    }

    const translation = await translateText(text, target);
    return res.json(new ApiResponse(200, { translation }, "OK"));
});

// POST /api/v1/ai/transcribe  (multipart: audio)
export const transcribe = asyncHandler(async (req, res) => {
    const file = req.file?.path;
    if (!file) throw new ApiError(400, "Audio file is required");

    if (!hasOpenAIKey()) {
        return respondUnavailable(res, "Transcription requires OPENAI_API_KEY to be configured.");
    }

    // Operates only on the uploaded file already on local disk. There is no path
    // from a YouTube id to this route: YouTube media is never downloaded,
    // re-hosted, converted or sent to Whisper.
    const result = await transcribeAudio(file, { lang: req.body?.lang });
    return res.json(new ApiResponse(200, result, "OK"));
});

// POST /api/v1/ai/videos/:videoId/reindex   -  owner-only reindex
export const reindexVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    if (!isValidObjectId(videoId)) throw new ApiError(400, "Invalid video id");

    /**
     * This route needs BOTH capabilities: `autoTagAndSummarize` calls the chat model
     * (credits) and `generateEmbedding` calls the active embedding provider (local).
     * The chat call is the binding constraint, so the key check stays — a local
     * embedding provider does not make auto-tagging possible.
     */
    if (!hasOpenAIKey()) {
        return respondUnavailable(res, "Reindexing requires OPENAI_API_KEY to be configured.");
    }

    const video = await Video.findById(videoId).populate("anime");
    if (!video) throw new ApiError(404, "Video not found");
    if (!video.owner.equals(req.user._id)) throw new ApiError(403, "Not authorized");

    const { tags, summary, category } = await autoTagAndSummarize({
        title: video.title,
        description: video.description,
    });

    /**
     * The embedding text is built from the document as it will be *after* the new
     * tags and category are applied, so the stored hash describes the stored state.
     * Building it from the pre-update document would leave the hash permanently
     * disagreeing with the content and force a re-embed on the next backfill.
     *
     * The builder reads a fixed whitelist of fields, so no secret, credential or
     * user datum can reach the provider — `owner` is not read at all.
     */
    const text = buildVideoEmbeddingText(
        {
            ...video.toObject(),
            tags,
            category,
        },
        { anime: video.anime }
    );

    const embeddingFields = await generateEmbedding(text);

    // Only AI-owned fields are written. sourceType, videoFile, externalVideoId,
    // owner, thumbnail and every other media field are untouched.
    await Video.updateOne(
        { _id: videoId },
        { $set: { tags, category, aiSummary: summary, ...embeddingFields } }
    );

    return res.json(new ApiResponse(200, { tags, category, summary }, "Reindexed"));
});

// GET /api/v1/ai/health
export const aiHealth = asyncHandler(async (req, res) => {
    const status = embeddingStatus();

    /**
     * `openai` and `embedding.configured` are now genuinely independent, and both are
     * reported. Previously they were the same boolean because embeddings were the only
     * consumer of the key; conflating them now would claim OpenAI is configured
     * whenever the local embedder is up, which is false and actively misleading when
     * an operator is diagnosing a 429.
     *
     * Same field names and same envelope as before — `embedding` simply gains
     * `provider` — so no existing consumer of this endpoint breaks.
     *
     * Reports whether a key exists — never any part of its value.
     */
    const openaiConfigured = hasOpenAIKey();

    return res.json(
        new ApiResponse(
            200,
            {
                openai: openaiConfigured,
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                embedding: {
                    configured: status.configured,
                    provider: status.provider,
                    model: status.model,
                    dimensions: status.dimensions,
                    version: status.version,
                },
                chat: describeChatProvider(),
            },
            // The embedding path is what the AI features are built on, and it is
            // configured. A missing chat key is reported in `openai` rather than by
            // declaring the whole subsystem down.
            status.configured
                ? openaiConfigured
                    ? "OK"
                    : "OK — local embeddings and AnimeVerse chat are available without a paid API; Gemini free-tier can be enabled separately, while legacy OpenAI-only summary, tagging and transcription features remain unavailable."
                : "AI is not configured"
        )
    );
});

/**
 * Exported for the diagnostics the backfill prints. Not routed: adding an endpoint
 * is Session 2 work.
 */
export const embeddingDiagnostics = { describeEmbeddingState };
