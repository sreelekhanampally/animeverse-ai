const VALID_NODE_ENVS = new Set(["development", "test", "production"]);
const VALID_CHAT_PROVIDERS = new Set(["auto", "gemini", "ollama", "retrieval"]);
const VALID_EMBEDDING_PROVIDERS = new Set(["local", "openai"]);

const blank = (value) => !String(value || "").trim();
const looksPlaceholder = (value) => /change-me|<[^>]+>|your[-_ ]?secret|replace[-_ ]?me/i.test(String(value || ""));
const positiveInt = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

const addRequired = (errors, env, name) => {
    if (blank(env[name])) errors.push(`${name} is required`);
};

export function validateEnvironment({ mode = "startup", env = process.env } = {}) {
    const errors = [];
    const warnings = [];
    const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
    const production = nodeEnv === "production" || mode === "deployment";

    if (!VALID_NODE_ENVS.has(nodeEnv)) errors.push("NODE_ENV must be development, test, or production");
    if (!positiveInt(env.PORT || 8000)) errors.push("PORT must be a positive integer");

    for (const name of [
        "MONGODB_URI",
        "ACCESS_TOKEN_SECRET",
        "ACCESS_TOKEN_EXPIRY",
        "REFRESH_TOKEN_SECRET",
        "REFRESH_TOKEN_EXPIRY",
    ]) {
        addRequired(errors, env, name);
    }

    if (!blank(env.MONGODB_URI) && !/^mongodb(?:\+srv)?:\/\//i.test(env.MONGODB_URI)) {
        errors.push("MONGODB_URI must be a mongodb:// or mongodb+srv:// URI");
    }

    const corsOrigins = String(env.CORS_ORIGIN || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    if (production) {
        if (!corsOrigins.length) errors.push("CORS_ORIGIN is required for production");
        if (corsOrigins.includes("*")) errors.push("CORS_ORIGIN must not contain * in production");

        for (const name of ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"]) {
            const value = String(env[name] || "");
            if (value.length < 32) errors.push(`${name} must be at least 32 characters in production`);
            if (looksPlaceholder(value)) errors.push(`${name} still contains a placeholder value`);
        }
    }

    const chatProvider = String(env.ANIME_CHAT_PROVIDER || "auto").trim().toLowerCase();
    if (!VALID_CHAT_PROVIDERS.has(chatProvider)) {
        errors.push("ANIME_CHAT_PROVIDER must be auto, gemini, ollama, or retrieval");
    }
    if (chatProvider === "gemini" && blank(env.GEMINI_API_KEY)) {
        warnings.push("ANIME_CHAT_PROVIDER is gemini but GEMINI_API_KEY is not configured; local fallback will be used");
    }

    const embeddingProvider = String(env.EMBEDDING_PROVIDER || "local").trim().toLowerCase();
    if (!VALID_EMBEDDING_PROVIDERS.has(embeddingProvider)) {
        errors.push("EMBEDDING_PROVIDER must be local or openai");
    }
    if (embeddingProvider === "openai" && blank(env.OPENAI_API_KEY)) {
        errors.push("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
    }

    const numericSettings = [
        "GEMINI_TIMEOUT_MS",
        "GEMINI_CIRCUIT_FAILURE_THRESHOLD",
        "GEMINI_CIRCUIT_COOLDOWN_MS",
        "APP_REQUEST_TIMEOUT_MS",
        "AI_REQUEST_TIMEOUT_MS",
        "UPLOAD_REQUEST_TIMEOUT_MS",
        "SERVER_REQUEST_TIMEOUT_MS",
        "SERVER_HEADERS_TIMEOUT_MS",
        "SERVER_KEEP_ALIVE_TIMEOUT_MS",
        "SHUTDOWN_GRACE_MS",
        "MONGODB_SERVER_SELECTION_TIMEOUT_MS",
        "MONGODB_CONNECT_TIMEOUT_MS",
        "MONGODB_SOCKET_TIMEOUT_MS",
    ];
    for (const name of numericSettings) {
        if (!blank(env[name]) && !positiveInt(env[name])) errors.push(`${name} must be a positive integer`);
    }

    if (mode === "deployment") {
        for (const name of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) {
            addRequired(errors, env, name);
        }
        if (blank(env.GEMINI_API_KEY)) warnings.push("GEMINI_API_KEY is not set; AI Companion will use local fallback paths");
        if (blank(env.YOUTUBE_API_KEY)) warnings.push("YOUTUBE_API_KEY is not set; YouTube ingestion commands will be unavailable");
    }

    return {
        ok: errors.length === 0,
        mode,
        nodeEnv,
        errors,
        warnings,
        features: {
            gemini: !blank(env.GEMINI_API_KEY),
            openai: !blank(env.OPENAI_API_KEY),
            youtubeIngest: !blank(env.YOUTUBE_API_KEY),
            cloudinary:
                !blank(env.CLOUDINARY_CLOUD_NAME) &&
                !blank(env.CLOUDINARY_API_KEY) &&
                !blank(env.CLOUDINARY_API_SECRET),
            embeddingProvider,
            chatProvider,
        },
    };
}

export class EnvironmentValidationError extends Error {
    constructor(result) {
        super(`Environment validation failed: ${result.errors.join("; ")}`);
        this.name = "EnvironmentValidationError";
        this.code = "ENV_VALIDATION_FAILED";
        this.result = result;
    }
}

export function assertEnvironment(options = {}) {
    const result = validateEnvironment(options);
    if (!result.ok) throw new EnvironmentValidationError(result);
    return result;
}

export const envInternals = { blank, looksPlaceholder, positiveInt };
