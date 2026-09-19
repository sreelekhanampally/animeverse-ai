import { logger } from "../utils/logger.js";

const positiveMs = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const timeoutForRequest = (req) => {
    const contentType = String(req.get?.("content-type") || req.headers?.["content-type"] || "");
    if (contentType.includes("multipart/form-data")) {
        return positiveMs(process.env.UPLOAD_REQUEST_TIMEOUT_MS, 10 * 60_000);
    }
    if (String(req.originalUrl || req.url || "").startsWith("/api/v1/ai")) {
        return positiveMs(process.env.AI_REQUEST_TIMEOUT_MS, 90_000);
    }
    return positiveMs(process.env.APP_REQUEST_TIMEOUT_MS, 30_000);
};

export const requestTimeout = (req, res, next) => {
    const timeoutMs = timeoutForRequest(req);
    const controller = new AbortController();
    req.abortSignal = controller.signal;
    req.requestTimeoutMs = timeoutMs;

    const timer = setTimeout(() => {
        if (res.writableEnded) return;
        controller.abort(new Error("Request deadline exceeded"));
        logger.warn("http_request_timeout", {
            requestId: req.id,
            method: req.method,
            path: String(req.originalUrl || req.url || "/").split("?")[0],
            timeoutMs,
        });

        if (!res.headersSent) {
            res.status(504).json({
                statusCode: 504,
                success: false,
                code: "REQUEST_TIMEOUT",
                message: "The request took too long to complete.",
                requestId: req.id,
                errors: [],
                data: null,
            });
        } else {
            res.destroy();
        }
    }, timeoutMs);

    timer.unref?.();
    const clear = () => clearTimeout(timer);
    res.once("finish", clear);
    res.once("close", clear);
    next();
};

export const requestTimeoutInternals = { positiveMs };
