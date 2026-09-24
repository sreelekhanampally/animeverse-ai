import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ragHealth, ragSearch } from "../controllers/rag.controller.js";

const router = Router();

const ragLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
});

router.get("/health", ragHealth);
router.post("/search", ragLimiter, ragSearch);

export default router;
