import { Router } from "express";
import { healthcheck, liveness, readiness } from "../controllers/healthcheck.controller.js";

const router = Router();

router.get("/", healthcheck);
router.get("/live", liveness);
router.get("/ready", readiness);

export default router;
