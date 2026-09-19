import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

const normalizeError = (err) => {
    if (err instanceof ApiError) {
        return {
            statusCode: err.statusCode,
            code: err.code || "API_ERROR",
            message: err.message,
            errors: err.errors || [],
            expose: true,
        };
    }

    if (err?.name === "ValidationError") {
        return {
            statusCode: 400,
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            errors: Object.values(err.errors || {}).map((item) => item?.message).filter(Boolean).slice(0, 20),
            expose: true,
        };
    }

    if (err?.name === "CastError") {
        return { statusCode: 400, code: "INVALID_ID", message: "Invalid identifier", errors: [], expose: true };
    }

    if (err?.code === 11000) {
        const fields = Object.keys(err.keyPattern || err.keyValue || {}).slice(0, 10);
        return {
            statusCode: 409,
            code: "DUPLICATE_RESOURCE",
            message: fields.length ? `A record with this ${fields.join(", ")} already exists` : "Duplicate resource",
            errors: [],
            expose: true,
        };
    }

    if (err?.name === "MulterError") {
        return {
            statusCode: err.code === "LIMIT_FILE_SIZE" ? 413 : 400,
            code: String(err.code || "UPLOAD_ERROR"),
            message: err.code === "LIMIT_FILE_SIZE" ? "Uploaded file is too large" : "Upload failed",
            errors: [],
            expose: true,
        };
    }

    if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
        return { statusCode: 401, code: "INVALID_TOKEN", message: "Invalid or expired session", errors: [], expose: true };
    }

    if (err?.type === "entity.too.large") {
        return { statusCode: 413, code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large", errors: [], expose: true };
    }

    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    return {
        statusCode,
        code: typeof err?.code === "string" ? err.code : statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message: err?.message || "Internal Server Error",
        errors: Array.isArray(err?.errors) ? err.errors : [],
        expose: statusCode < 500 || Number.isInteger(err?.statusCode),
    };
};

export const notFound = (req, res, next) => {
    next(new ApiError(404, `Route ${req.originalUrl} not found`, [], "", "ROUTE_NOT_FOUND"));
};

export const errorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const normalized = normalizeError(err);
    const isProduction = process.env.NODE_ENV === "production";
    const message = isProduction && !normalized.expose ? "Internal Server Error" : normalized.message;

    const log = normalized.statusCode >= 500 ? logger.error : logger.warn;
    log("request_error", {
        requestId: req.id,
        method: req.method,
        path: String(req.originalUrl || req.url || "/").split("?")[0],
        statusCode: normalized.statusCode,
        code: normalized.code,
        error: err,
    });

    return res.status(normalized.statusCode).json({
        statusCode: normalized.statusCode,
        success: false,
        code: normalized.code,
        message,
        requestId: req.id,
        errors: normalized.errors,
        data: null,
    });
};

export const errorMiddlewareInternals = { normalizeError };
