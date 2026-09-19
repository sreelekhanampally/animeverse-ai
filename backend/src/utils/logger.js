const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|credential)/i;

const redactText = (value) =>
    String(value)
        .replace(/mongodb(?:\+srv)?:\/\/[^\s@]+@/gi, (match) => `${match.split("://")[0]}://[REDACTED]@`)
        .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
        .replace(/((?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");

const activeLevel = () => {
    const level = String(process.env.LOG_LEVEL || "info").toLowerCase();
    return LEVELS[level] ?? LEVELS.info;
};

const sanitize = (value, seen = new WeakSet(), depth = 0) => {
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
        const redacted = redactText(value);
        return redacted.length > 2_000 ? `${redacted.slice(0, 2_000)}…` : redacted;
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactText(value.message),
            ...(value.code ? { code: value.code } : {}),
            ...(value.statusCode ? { statusCode: value.statusCode } : {}),
            ...(value.stack ? { stack: redactText(value.stack) } : {}),
        };
    }
    if (typeof value !== "object") return String(value);
    if (depth > 5) return "[MaxDepth]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, seen, depth + 1));

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, seen, depth + 1),
        ])
    );
};

const emit = (level, event, metadata = {}) => {
    if ((LEVELS[level] ?? LEVELS.info) < activeLevel()) return;

    const payload = {
        timestamp: new Date().toISOString(),
        level,
        service: "animeverse-backend",
        environment: process.env.NODE_ENV || "development",
        event,
        ...sanitize(metadata),
    };

    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
};

export const logger = Object.freeze({
    debug: (event, metadata) => emit("debug", event, metadata),
    info: (event, metadata) => emit("info", event, metadata),
    warn: (event, metadata) => emit("warn", event, metadata),
    error: (event, metadata) => emit("error", event, metadata),
});

export const loggerInternals = { sanitize, redactText, LEVELS };
