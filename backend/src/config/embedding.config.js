/**
 * The single source of truth for embedding identity.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The original scaffold decided the embedding model inline in ai.service.js
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
 * So the provider, the model, its dimension count and a version tag live here,
 * together, and every writer stamps model/dimensions/version onto the document
 * alongside the vector. A model change means editing this file, which mechanically
 * invalidates every existing vector (they no longer match the active triple)
 * rather than mixing new and old silently.
 *
 * WHY THERE IS A PROVIDER CONCEPT NOW
 * -----------------------------------
 * Session 1 hard-wired OpenAI. That made the entire vector path unusable the
 * moment the account ran out of credits — the API answers `429 You have no
 * credits remaining`, so not a single document could be indexed and no amount of
 * correct code downstream mattered.
 *
 * A provider is therefore named data rather than an assumption. `local` runs
 * sentence-transformers/all-MiniLM-L6-v2 in-process through ONNX Runtime and
 * needs no key, no network at steady state and no Python. `openai` is preserved
 * as a described, selectable configuration so the previous behaviour is a config
 * change rather than a rewrite, and so the reason the two are incompatible
 * (1536 dimensions vs 384) is written down in one place.
 *
 * Exactly one provider is active per deployment. Mixing them in one collection is
 * the failure this file exists to prevent, which is why the dimension count is
 * derived from the provider entry and never read from the environment.
 *
 * DIMENSIONS ARE NOT CONFIGURABLE BY ENV
 * --------------------------------------
 * Dimension count is a hard property of a model, not a preference. Making it an
 * env var would let a typo produce vectors that pass validation and are still
 * incompatible. all-MiniLM-L6-v2 returns 384 floats; text-embedding-3-small
 * returns 1536. If that ever needs to change, the model changes with it, here.
 */

/**
 * Every embedding provider AnimeVerse knows how to be configured for.
 *
 * Frozen, and the dimension count sits beside the model name it belongs to, so a
 * provider cannot be described with a dimension count that is not its own.
 */
export const EMBEDDING_PROVIDERS = Object.freeze({
    /**
     * Local inference. No API key, no per-document cost, no rate limit.
     *
     * The model is the sentence-transformers checkpoint, loaded from its exported
     * ONNX weights and run by onnxruntime-node inside this process. Sentence
     * embeddings are produced by mean-pooling the token states and L2-normalising,
     * which is what the sentence-transformers reference implementation does and is
     * the only way the vectors mean what the model card says they mean.
     */
    local: Object.freeze({
        name: "local",
        model: "sentence-transformers/all-MiniLM-L6-v2",
        dimensions: 384,
        requiresApiKey: false,
        /**
         * The checkpoint's own attention window, in word-piece tokens. Text beyond
         * it is truncated by the tokenizer, not by us — recorded here so the limit
         * is visible rather than discovered.
         */
        maxTokens: 256,
    }),

    /**
     * The Session 1 provider, retained as a real option.
     *
     * Not deleted: the OpenAI credentials still drive chat, summaries, tagging and
     * transcription, and an operator who tops the account up should be able to
     * return to 1536-dimensional vectors by editing one line here rather than by
     * reverting a migration. Doing so is a full reindex, exactly as switching away
     * from it was — which is the point of stamping provenance.
     */
    openai: Object.freeze({
        name: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        requiresApiKey: true,
        maxTokens: 8191,
    }),
});

/**
 * The active provider.
 *
 * Env-selectable because *which* provider a deployment uses is a legitimate
 * deployment decision, unlike the dimension count. An unknown value throws at
 * import time rather than defaulting quietly: silently falling back to `local`
 * after an operator asked for something else is how a collection ends up holding
 * two incompatible vector families.
 */
const requestedProvider = (process.env.EMBEDDING_PROVIDER || "local").trim().toLowerCase();

if (!Object.hasOwn(EMBEDDING_PROVIDERS, requestedProvider)) {
    throw new Error(
        `Unknown EMBEDDING_PROVIDER="${requestedProvider}". ` +
            `Supported providers: ${Object.keys(EMBEDDING_PROVIDERS).join(", ")}.`
    );
}

/** The active provider's full entry: name, model, dimensions, key requirement. */
export const EMBEDDING_PROVIDER_CONFIG = EMBEDDING_PROVIDERS[requestedProvider];

/** The active provider's short name — "local" or "openai". */
export const EMBEDDING_PROVIDER = EMBEDDING_PROVIDER_CONFIG.name;

/** The active model. Changing this MUST come with a new EMBEDDING_VERSION. */
export const EMBEDDING_MODEL = EMBEDDING_PROVIDER_CONFIG.model;

/** Fixed by the model above. Not read from the environment, deliberately. */
export const EMBEDDING_DIMENSIONS = EMBEDDING_PROVIDER_CONFIG.dimensions;

/**
 * Bumped whenever the vector representation changes — a new model, or a change in
 * the shape of the *text* fed to it. Two vectors from different models, or from
 * the same model over different text recipes, are comparable in the arithmetic
 * sense yet not in the semantic one, so both are part of a vector's identity.
 *
 * "metadata-v1" = the same text recipe embedded by text-embedding-3-small at 1536
 * dimensions (Session 1).
 * "metadata-v2" = that identical text recipe embedded by all-MiniLM-L6-v2 at 384
 * dimensions. The recipe is deliberately unchanged — titles + description +
 * genres/studios/format/status/season + main characters for anime; title +
 * description + tags + category + linked anime (+ a legitimately stored
 * transcript, when one exists) for videos — so the only difference between the
 * two versions is the model, which is what makes the bump auditable.
 *
 * Every vector written under metadata-v1 is now invalid by construction, which is
 * correct: none of them can be compared to a 384-float vector.
 */
export const EMBEDDING_VERSION = "metadata-v2";

/**
 * Hard ceiling on characters handed to the provider.
 *
 * Left at 24000 across the provider change on purpose. This value is an input to
 * the deterministic text recipe — it decides where a long text is cut, and the
 * SHA-256 of the result is what tells a later backfill "already indexed". Lowering
 * it would silently alter the text of every long document and force a re-embed
 * for a reason unrelated to the model swap.
 *
 * Note the model's own window is narrower than this: all-MiniLM-L6-v2 attends to
 * 256 word-piece tokens (~1000 characters) and its tokenizer truncates the rest.
 * For the current corpus that is not reached — anime and video metadata texts run
 * a few hundred characters — and transcripts are unavailable, so nothing is
 * currently affected. When transcripts do arrive, embedding one long text as a
 * single vector is the wrong shape anyway; per-segment vectors are the scene-search
 * design, and that is Session 2 work.
 */
export const EMBEDDING_MAX_CHARS = 24000;

/**
 * The env var holding the OpenAI key. Named here so nothing else has to repeat the
 * string, and so it is obvious there is exactly one credential involved.
 * Server-side only: never returned by an endpoint, never written to MongoDB.
 */
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/**
 * Where the local model's weights are cached on disk.
 *
 * A path, not a secret. Defaults inside the backend directory so a checkout is
 * self-contained; override when several deployments should share one download.
 */
export const LOCAL_EMBEDDING_CACHE_DIR_ENV = "LOCAL_EMBEDDING_CACHE_DIR";

/** True when an OpenAI key is present. Governs chat/summary/transcription too. */
export const hasOpenAIKey = () => Boolean(process.env[OPENAI_API_KEY_ENV]?.trim());

/**
 * Can the active provider produce vectors at all?
 *
 * For `local` this is unconditionally true: the provider needs no credential, so
 * there is nothing to be unconfigured about. Weights may still be missing from
 * disk with no network to fetch them, but that is a runtime failure with its own
 * error (EmbeddingModelLoadError), not a configuration state — and answering
 * "configured: false" for it would send an operator looking for a missing key
 * that was never required.
 *
 * For `openai` it is the key check that was here before, unchanged.
 */
export const hasEmbeddingProvider = () =>
    EMBEDDING_PROVIDER_CONFIG.requiresApiKey ? hasOpenAIKey() : true;

/**
 * The active identity as a plain object, for stamping onto a document.
 *
 * Returned fresh each call rather than exported as a shared constant: a caller
 * that spread it into a Mongoose update and then mutated the result would
 * otherwise corrupt the config for the whole process.
 *
 * Deliberately still the same three fields Session 1 wrote. The provider name is
 * NOT stamped: it is already implied by the model, and adding a field would make
 * every existing document fail validation for a second, redundant reason.
 */
export const activeEmbeddingIdentity = () => ({
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingVersion: EMBEDDING_VERSION,
});

/**
 * Raised when an embedding is requested while the active provider has no way to
 * run — today only reachable with the `openai` provider and no key.
 *
 * A distinct class, not a generic Error, so callers can answer "AI is not
 * configured" (a 503 operational state) rather than "something broke" (a 500).
 * Mirrors the YouTubeConfigError convention already used in youtube.service.js.
 */
export class EmbeddingUnavailableError extends Error {
    constructor(
        message = `AI is not configured: the "${EMBEDDING_PROVIDER}" embedding provider is unavailable, so embeddings cannot be generated.`
    ) {
        super(message);
        this.name = "EmbeddingUnavailableError";
        this.isUnavailable = true;
        // 503, not 500: the service is fine, it is unconfigured. The global error
        // handler in app.js reads `statusCode` off the error, so an uncaught throw
        // still produces an honest response.
        this.statusCode = 503;
    }
}

/**
 * Raised when the local model cannot be loaded — weights absent from the cache
 * with no network to fetch them, a corrupt download, an ONNX Runtime failure.
 *
 * Separate from EmbeddingUnavailableError because the remedy is different: this is
 * "the model could not be brought up", not "you forgot to configure a key", and
 * an operator told to set an API key for a local provider would be sent in
 * precisely the wrong direction. Carries the original failure as `cause` so the
 * underlying message is never swallowed.
 */
export class EmbeddingModelLoadError extends Error {
    constructor(message, { cause } = {}) {
        super(message, { cause });
        this.name = "EmbeddingModelLoadError";
        this.isUnavailable = true;
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
