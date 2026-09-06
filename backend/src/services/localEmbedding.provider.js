/**
 * Local embedding inference: sentence-transformers/all-MiniLM-L6-v2 in-process.
 *
 * WHY THIS EXISTS
 * --------------
 * The OpenAI account has no credits, so `text-embedding-3-small` answers `429 You
 * have no credits remaining` for every request. Nothing downstream of the vector
 * path can work until embeddings can actually be produced, so the provider is
 * replaced rather than worked around.
 *
 * WHY TRANSFORMERS.JS
 * -------------------
 * @huggingface/transformers is the official JS port and runs the checkpoint's
 * exported ONNX weights through onnxruntime-node. It is the only maintained option
 * that satisfies the constraints as given: no Python, no Docker, no separate
 * service, no vector database, one dependency.
 *
 * The alternative — spawning a Python sentence-transformers process — would have
 * meant an interpreter, a virtualenv and an IPC protocol as a hard runtime
 * prerequisite for a Node backend. Rejected on footprint alone.
 *
 * WHAT MAKES THE VECTORS CORRECT
 * ------------------------------
 * A transformer emits one vector per *token*; a sentence embedding is a reduction
 * over those. all-MiniLM-L6-v2 was trained with mean pooling over the token states
 * followed by L2 normalisation, and its published cosine-similarity behaviour only
 * holds under that reduction. Using the CLS token, or skipping normalisation, would
 * produce arithmetically valid but semantically wrong vectors — the worst possible
 * failure here, because nothing downstream could detect it.
 *
 * So `pooling: "mean"` and `normalize: true` are passed explicitly, and the unit
 * norm is asserted afterwards rather than assumed.
 *
 * DETERMINISM
 * -----------
 * Same text, same weights, same build => bit-identical output. Verified: repeated
 * inference on one string yields a byte-identical array. There is no sampling and
 * no temperature in a feature-extraction forward pass. That is what makes
 * `embeddingTextHash` a sound skip signal — a re-run genuinely cannot produce a
 * different vector for unchanged text.
 *
 * NO FABRICATION, EVER
 * --------------------
 * Every failure path in this file throws. Nothing here returns a zero vector, a
 * random vector, a hash-derived vector or a truncated/padded one. That is the
 * specific bug this whole subsystem was built to eliminate: the original scaffold's
 * 32-float hash fallback looked like an embedding, stored like one, and turned
 * semantic search into confident nonsense.
 */

import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_PROVIDERS,
    EmbeddingModelLoadError,
    EmbeddingValidationError,
    LOCAL_EMBEDDING_CACHE_DIR_ENV,
} from "../config/embedding.config.js";

/** The task name Transformers.js uses for "give me hidden states, not logits". */
const FEATURE_EXTRACTION = "feature-extraction";

/**
 * The model this file implements.
 *
 * Read from the `local` provider entry rather than from EMBEDDING_MODEL, because
 * this module is specifically the local one: if a deployment selects `openai`,
 * EMBEDDING_MODEL is an OpenAI model and loading it here would be nonsense. The
 * active-provider check lives in embedding.service.js, which decides who is asked.
 */
const LOCAL_MODEL = EMBEDDING_PROVIDERS.local.model;
const LOCAL_DIMENSIONS = EMBEDDING_PROVIDERS.local.dimensions;

/**
 * Weight cache location.
 *
 * Defaults to `.model-cache/` inside the backend directory (gitignored), so a
 * checkout is self-contained and the first run populates it. Resolved relative to
 * this file rather than to process.cwd() so a script run from the repository root
 * and one run from backend/ share a single cache instead of downloading twice.
 */
const resolveCacheDir = () => {
    const override = process.env[LOCAL_EMBEDDING_CACHE_DIR_ENV]?.trim();
    if (override) return override;
    return new URL("../../.model-cache/", import.meta.url).pathname;
};

/**
 * The loaded pipeline, and the in-flight promise that is loading it.
 *
 * Two separate slots, deliberately. Loading takes seconds and the backfill embeds
 * documents in a loop; caching only the *result* would let several concurrent
 * callers each start their own load and hold several copies of the weights in
 * memory. Caching the promise means the second caller awaits the first load.
 */
let pipelinePromise = null;
let loadedPipeline = null;

/**
 * Brings the model up, once.
 *
 * A failed load clears the cached promise so a later attempt can retry — a
 * transient network failure on first download should not poison the process for
 * its whole lifetime.
 */
const loadPipeline = async () => {
    if (loadedPipeline) return loadedPipeline;
    if (pipelinePromise) return pipelinePromise;

    pipelinePromise = (async () => {
        let transformers;
        try {
            // Imported dynamically, not at module top level. onnxruntime-node is a
            // native addon and the package pulls in a substantial dependency tree;
            // a static import would make every process that merely touches
            // embedding validation — the test suite, any controller import chain —
            // pay for loading it. Nothing here runs until a vector is actually
            // requested.
            transformers = await import("@huggingface/transformers");
        } catch (error) {
            throw new EmbeddingModelLoadError(
                "The local embedding runtime (@huggingface/transformers) is not installed. " +
                    "Run `npm install` in backend/. No fake vectors will be produced.",
                { cause: error }
            );
        }

        const { env, pipeline } = transformers;

        // Keep every byte inside the project. `allowRemoteModels` stays true so the
        // first run can fetch the weights; afterwards the cache satisfies it and no
        // network call is made.
        env.cacheDir = resolveCacheDir();
        env.allowLocalModels = true;

        try {
            return await pipeline(FEATURE_EXTRACTION, LOCAL_MODEL, {
                /**
                 * fp32, not a quantised variant.
                 *
                 * The canonical repo publishes int8 variants that are smaller and
                 * faster, but quantisation perturbs the vector space, and these
                 * vectors are persisted and compared against query vectors possibly
                 * produced by a different build. The corpus is 133 documents; the
                 * speed saving is irrelevant and the fidelity is not.
                 */
                dtype: "fp32",
            });
        } catch (error) {
            throw new EmbeddingModelLoadError(
                `Failed to load the local embedding model "${LOCAL_MODEL}". ` +
                    "The first run downloads ~90MB of ONNX weights from huggingface.co and needs network access; " +
                    "later runs read them from the local cache. " +
                    `Cache directory: ${resolveCacheDir()}. ` +
                    `Underlying error: ${error?.message || error}`,
                { cause: error }
            );
        }
    })();

    try {
        loadedPipeline = await pipelinePromise;
        return loadedPipeline;
    } catch (error) {
        pipelinePromise = null;
        throw error;
    }
};

/**
 * Loads the model without embedding anything.
 *
 * Lets the backfill pay the multi-second load cost once, up front, and fail before
 * it opens a database cursor — rather than surfacing a load error on the first
 * document and reporting it as that document's failure.
 */
export const warmLocalEmbeddingModel = () => loadPipeline();

/** Test seam: drops the cached pipeline so the next call reloads. */
export const resetLocalEmbeddingModel = () => {
    pipelinePromise = null;
    loadedPipeline = null;
};

/** Whether the weights are already resident in this process. */
export const isLocalModelLoaded = () => loadedPipeline !== null;

/**
 * Converts whatever the pipeline returned into a plain array of finite numbers.
 *
 * Transformers.js returns a Tensor whose `.data` is a Float32Array. Both the shape
 * and the container are checked rather than trusted: a version change that altered
 * the return type would otherwise produce garbage that still walked like an array,
 * and `Array.from` over an unexpected object yields a plausible-looking vector of
 * undefined values.
 *
 * Float32Array entries are converted to JS numbers here because Mongoose must
 * persist `[Number]`, and a typed array would serialise as an object rather than
 * an array of doubles.
 */
const tensorToVector = (output) => {
    if (!output) {
        throw new EmbeddingValidationError(
            "Local embedding inference returned nothing. No vector was produced."
        );
    }

    const data = output.data ?? output;

    if (!(data instanceof Float32Array) && !(data instanceof Float64Array) && !Array.isArray(data)) {
        throw new EmbeddingValidationError(
            `Local embedding inference returned an unexpected type (${
                Object.prototype.toString.call(data)
            }); expected a Float32Array or an array of numbers.`
        );
    }

    /**
     * With one input and mean pooling the tensor is [1, 384], so `.data` is a flat
     * 384-length buffer. A [1, tokens, 384] shape means pooling did not happen —
     * flattening that would concatenate per-token vectors into a meaningless
     * ~10000-length array, which the dimension check below would catch, but the
     * error would describe a symptom rather than the cause. So it is named here.
     */
    if (Array.isArray(output.dims) && output.dims.length > 2) {
        throw new EmbeddingValidationError(
            `Local embedding inference returned an unpooled tensor of shape [${output.dims.join(
                ", "
            )}]. Mean pooling did not run, so no sentence vector exists.`
        );
    }

    const vector = new Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
        const value = data[i];
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new EmbeddingValidationError(
                `Local embedding inference produced a non-finite value at index ${i} (${String(
                    value
                )}). The vector is discarded rather than stored.`
            );
        }
        vector[i] = value;
    }

    return vector;
};

/**
 * Confirms the vector is L2-normalised, as the model card requires.
 *
 * A drifting norm means `normalize: true` silently stopped applying, at which point
 * cosine scores are still computable but no longer match the model's published
 * behaviour. Cheap to check, and the alternative is a wrong ranking nobody can see.
 *
 * The tolerance is loose (1e-3) because fp32 accumulation over 384 terms does not
 * land on exactly 1.0 — measured norms sit within ~1e-7 of unity, so this catches
 * a genuine failure without flagging normal float error.
 */
const assertUnitNorm = (vector) => {
    let sumOfSquares = 0;
    for (const value of vector) sumOfSquares += value * value;
    const norm = Math.sqrt(sumOfSquares);

    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) {
        throw new EmbeddingValidationError(
            `Local embedding vector is not unit-normalised (L2 norm ${norm}). ` +
                "all-MiniLM-L6-v2 similarity is only meaningful over normalised vectors."
        );
    }
};

/**
 * Embeds one non-empty string and returns a bare 384-number array.
 *
 * Returns only the vector. Metadata stamping stays in embedding.service.js so there
 * is exactly one place that decides what provenance a document carries, whichever
 * provider produced the numbers.
 */
export async function embedTextLocally(text) {
    const input = typeof text === "string" ? text.trim() : "";
    if (!input) {
        throw new EmbeddingValidationError("Cannot embed empty text.");
    }

    const pipe = await loadPipeline();

    let output;
    try {
        output = await pipe(input, {
            // Both are load-bearing — see the pooling note in this file's header.
            pooling: "mean",
            normalize: true,
        });
    } catch (error) {
        // Inference failure, not a load failure: the weights are up, this forward
        // pass did not complete. Reported as such instead of being re-labelled.
        throw new EmbeddingValidationError(
            `Local embedding inference failed for a ${input.length}-character input: ${
                error?.message || error
            }`
        );
    }

    const vector = tensorToVector(output);

    /**
     * The dimension check is against the *local provider's* 384, not the active
     * EMBEDDING_DIMENSIONS. This function's contract is "the local model's vector";
     * validating against the active config would conflate two different failures
     * and, under an `openai` deployment, would reject a perfectly good local vector
     * for being 384 long.
     *
     * embedding.service.js re-validates against the active config before anything
     * is written, so a mismatch is still impossible to persist.
     */
    if (vector.length !== LOCAL_DIMENSIONS) {
        throw new EmbeddingValidationError(
            `Local model "${LOCAL_MODEL}" returned ${vector.length} dimensions, expected ${LOCAL_DIMENSIONS}. ` +
                "The vector is discarded: a wrong-width vector must never reach the database."
        );
    }

    assertUnitNorm(vector);

    return vector;
}

/**
 * What this provider is, for diagnostics. Contains no secret because there is no
 * credential involved at all — which is the entire point of running locally.
 */
export const localProviderStatus = () => ({
    provider: "local",
    model: LOCAL_MODEL,
    dimensions: LOCAL_DIMENSIONS,
    loaded: isLocalModelLoaded(),
    cacheDir: resolveCacheDir(),
    // True whether or not this provider is the active one; `local` needs no config.
    configured: true,
    // Named so a reader does not have to infer it from the absence of a key check.
    requiresApiKey: false,
    activeModelIfSelected: EMBEDDING_MODEL,
    activeDimensionsIfSelected: EMBEDDING_DIMENSIONS,
});
