import { Router } from "express";
import { verifyJWT, optionalJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import {
    getVideoSummary,
    askAboutVideo,
    semanticSearch,
    recommendations,
    videoCommentSentiment,
    translate,
    transcribe,
    reindexVideo,
    aiHealth,
} from "../controllers/ai.controller.js";

const router = Router();

// Public / optional-auth
router.get("/health", aiHealth);
router.get("/search", semanticSearch);
router.get("/recommendations", optionalJWT, recommendations);
router.get("/videos/:videoId/summary", getVideoSummary);
router.get("/videos/:videoId/sentiment", videoCommentSentiment);

// Auth required
router.post("/videos/:videoId/ask", verifyJWT, askAboutVideo);
router.post("/videos/:videoId/reindex", verifyJWT, reindexVideo);
router.post("/translate", verifyJWT, translate);
router.post("/transcribe", verifyJWT, upload.single("audio"), transcribe);

export default router;
