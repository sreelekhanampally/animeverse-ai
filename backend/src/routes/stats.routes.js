import { Router } from "express";
import { getPlatformStats } from "../controllers/stats.controller.js";

const router = Router();

// PUBLIC — the homepage hero renders before login, so no auth here. The payload
// is two aggregate counts and exposes nothing about any individual user.
router.route("/").get(getPlatformStats);

export default router;
