import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verifyJWT, optionalJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import {
    getVideoSummary,
    askAboutVideo,
    semanticSearch,
    semanticSearchPost,
    animeChat,
    recommendations,
    videoCommentSentiment,
    translate,
    transcribe,
    reindexVideo,
    aiHealth,
} from "../controllers/ai.controller.js";

const router = Router();

// Local inference still consumes CPU. These limits prevent a public endpoint from
// turning the Node process into an embedding benchmark while keeping normal search fluid.
const semanticSearchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
});

const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

// Public / optional-auth
router.get("/health", aiHealth);
router.get("/search", semanticSearchLimiter, semanticSearch);
router.post("/semantic-search", semanticSearchLimiter, semanticSearchPost);
router.post("/chat", chatLimiter, animeChat);
router.get("/recommendations", optionalJWT, recommendations);
router.get("/videos/:videoId/summary", getVideoSummary);
router.get("/videos/:videoId/sentiment", videoCommentSentiment);

// Auth required
router.post("/videos/:videoId/ask", verifyJWT, askAboutVideo);
router.post("/videos/:videoId/reindex", verifyJWT, reindexVideo);
router.post("/translate", verifyJWT, translate);
router.post("/transcribe", verifyJWT, upload.single("audio"), transcribe);

export default router;
