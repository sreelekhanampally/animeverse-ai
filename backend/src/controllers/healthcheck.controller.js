import mongoose from "mongoose";
import { ApiResponse } from "../utils/ApiResponse.js";
import { validateEnvironment } from "../config/env.js";
import { runtimeHealth } from "../services/runtimeHealth.service.js";

const DB_STATES = Object.freeze({
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
});

export const liveness = async (req, res) => {
    return res.status(200).json(
        new ApiResponse(
            200,
            {
                status: "ok",
                uptimeSeconds: Math.floor(process.uptime()),
                requestId: req.id,
            },
            "Server is alive"
        )
    );
};

export const readiness = async (req, res) => {
    const runtime = runtimeHealth();
    const env = validateEnvironment({ mode: "startup" });
    const dbState = mongoose.connection.readyState;
    const databaseReady = dbState === 1;
    const ready = databaseReady && env.ok && !runtime.shuttingDown;

    const payload = {
        status: ready ? "ready" : "not_ready",
        requestId: req.id,
        checks: {
            database: {
                ok: databaseReady,
                state: DB_STATES[dbState] || "unknown",
            },
            environment: {
                ok: env.ok,
                issueCount: env.errors.length,
            },
            shutdown: {
                ok: !runtime.shuttingDown,
                inProgress: runtime.shuttingDown,
            },
        },
    };

    return res
        .status(ready ? 200 : 503)
        .json(new ApiResponse(ready ? 200 : 503, payload, ready ? "Server is ready" : "Server is not ready"));
};

// Backward-compatible alias for the original endpoint.
export const healthcheck = liveness;
