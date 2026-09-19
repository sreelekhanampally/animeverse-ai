import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { logger } from "../utils/logger.js";

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

const requestIdFrom = (req) => {
    const incoming = String(req.get("x-request-id") || "").trim();
    return REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
};

export const requestContext = (req, res, next) => {
    req.id = requestIdFrom(req);
    res.locals.requestId = req.id;
    res.setHeader("X-Request-ID", req.id);

    const startedAt = performance.now();
    let completed = false;
    const routePath = String(req.originalUrl || req.url || "/").split("?")[0];
    const shouldLog = process.env.LOG_HEALTH_REQUESTS === "true" || !routePath.includes("/healthcheck/");

    res.once("finish", () => {
        completed = true;
        if (!shouldLog) return;
        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const metadata = {
            requestId: req.id,
            method: req.method,
            path: routePath,
            statusCode: res.statusCode,
            durationMs,
            responseBytes: Number(res.getHeader("content-length")) || null,
        };
        if (res.statusCode >= 500) logger.error("http_request", metadata);
        else if (res.statusCode >= 400) logger.warn("http_request", metadata);
        else logger.info("http_request", metadata);
    });

    res.once("close", () => {
        if (completed || !shouldLog) return;
        logger.warn("http_request_aborted", {
            requestId: req.id,
            method: req.method,
            path: routePath,
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
        });
    });

    next();
};

export const requestContextInternals = { REQUEST_ID_RE, requestIdFrom };
