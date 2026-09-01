/**
 * The single source of truth for embedding identity.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The previous scaffold decided the embedding model inline in ai.service.js
 * (`process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small"`) and, when no API
 * key was present, produced a 32-dimensional hash vector instead. Both vectors
 * were written to the same `Video.embedding` field with no record of what made
 * them, so the collection ended up holding two mutually meaningless kinds of
 * number array and nothing could tell them apart after the fact.
 *
 * Cosine similarity between vectors from different models is not a weak signal —
 * it is noise, and `cosineSim` returned 0 for mismatched lengths, which sorts
 * identically to "perfectly unrelated". A silent model swap therefore degrades
 * search into random ordering with no error anywhere.
 *
 * So the model, its dimension count and a version tag live here, together, and
 * every writer stamps all three onto the document alongside the vector. A future
 * model change means editing this file, which mechanically invalidates every
 * existing vector (they no longer match the active triple) rather than mixing new
 * and old silently.
 *
 * DIMENSIONS ARE NOT CONFIGURABLE BY ENV
 * --------------------------------------
 * `EMBEDDING_DIMENSIONS` is a hard-coded property of the model, not a preference.
 * Making it an env var would let a typo produce vectors that pass validation and
 * are still incompatible. text-embedding-3-small returns 1536 floats; if that
 * ever needs to change, the model name changes with it, here.
 */

/** The active model. Changing this MUST come with a new EMBEDDING_VERSION. */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Fixed by the model above. Not read from the environment, deliberately. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Bumped whenever the *text* fed to the model changes shape, even if the model
 * stays the same. Two vectors from the same model but different text recipes are
 * comparable in the arithmetic sense yet not in the semantic one, so the recipe
 * is part of the vector's identity.
 *
 * "metadata-v1" = titles + description + genres/studios/format/status/season +
 * main characters for anime; title + description + tags + category + linked anime
 * (+ a legitimately stored transcript, when one exists) for videos.
 */
export const EMBEDDING_VERSION = "metadata-v1";

/**
 * Hard ceiling on characters sent to the embedding endpoint.
 *
 * text-embedding-3-small accepts 8191 tokens. At a conservative ~4 characters per
 * token that is roughly 32k characters, so 24000 leaves clear headroom while
 * still admitting a long transcript. Truncation is applied when the text is
 * *built*, not at call time, so the hash stored on the document describes exactly
 * the string that was embedded.
 */
export const EMBEDDING_MAX_CHARS = 24000;

/**
 * The env var holding the API key. Named here so nothing else has to repeat the
 * string, and so it is obvious there is exactly one credential involved.
 * Server-side only: never returned by an endpoint, never written to MongoDB.
 */
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/** True only when a non-empty key is configured. No key means no embeddings. */
export const hasEmbeddingProvider = () =>
    Boolean(process.env[OPENAI_API_KEY_ENV]?.trim());

/**
 * The active identity as a plain object, for stamping onto a document.
 *
 * Returned fresh each call rather than exported as a shared constant: a caller
 * that spread it into a Mongoose update and then mutated the result would
 * otherwise corrupt the config for the whole process.
 */
export const activeEmbeddingIdentity = () => ({
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingVersion: EMBEDDING_VERSION,
});

/**
 * Raised when an embedding is requested while no provider is configured.
 *
 * A distinct class, not a generic Error, so callers can answer "AI is not
 * configured" (a 503 operational state) rather than "something broke" (a 500).
 * Mirrors the YouTubeConfigError convention already used in youtube.service.js.
 */
export class EmbeddingUnavailableError extends Error {
    constructor(
        message = "AI is not configured: OPENAI_API_KEY is missing, so embeddings cannot be generated."
    ) {
        super(message);
        this.name = "EmbeddingUnavailableError";
        this.isUnavailable = true;
        // 503, not 500: the service is fine, it is unconfigured. The global error
        // handler in app.js reads `statusCode` off the error, so setting it here
        // means an uncaught throw still produces an honest response.
        this.statusCode = 503;
    }
}

/**
 * Raised when a vector is structurally wrong — wrong length, non-finite numbers,
 * or a model/version that is not the active one. Separate from the unavailable
 * case because the remedy is different: reindex, not configure.
 */
export class EmbeddingValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "EmbeddingValidationError";
        this.isValidationError = true;
        this.statusCode = 500;
    }
}
