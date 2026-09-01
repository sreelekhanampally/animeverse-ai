/**
 * Embedding generation and validation.
 *
 * Split out of ai.service.js so the vector path has one owner. ai.service.js keeps
 * the chat/summary/sentiment helpers and re-exports from here, which means the
 * existing routes keep working while everything that touches a vector goes through
 * exactly one set of rules.
 *
 * THE RULE THAT MATTERS
 * --------------------
 * When no API key is configured, this module throws. It does not return [], it
 * does not return a hash-derived vector, and it does not return a zero vector.
 *
 * The old scaffold returned a 32-float hash vector in that case. That is worse
 * than useless: it looks like a working embedding, it stores like one, and it
 * makes semantic search silently return arbitrary orderings that a reviewer could
 * easily mistake for weak-but-real relevance. A hash of a string carries no
 * semantic information at all — two paraphrases of the same sentence hash to
 * unrelated vectors, which is precisely the property semantic search exists to
 * avoid. Refusing to produce a vector is the only honest option, so an
 * unconfigured deployment reports "AI not configured" instead of quietly lying.
 */

import OpenAI from "openai";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    EmbeddingUnavailableError,
    EmbeddingValidationError,
    activeEmbeddingIdentity,
    hasEmbeddingProvider,
} from "../config/embedding.config.js";
import { hashEmbeddingText } from "../utils/embeddingText.js";

export {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    EmbeddingUnavailableError,
    EmbeddingValidationError,
    activeEmbeddingIdentity,
    hasEmbeddingProvider,
};

/**
 * Lazily constructed, then cached.
 *
 * Not built at import time: the key is read from the environment when first
 * needed, so a test or script that loads this module without a key does not
 * explode on import, and the constructor is not paid for by requests that never
 * embed anything.
 */
let client = null;

const getClient = () => {
    if (!hasEmbeddingProvider()) throw new EmbeddingUnavailableError();
    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });
    }
    return client;
};

/** Test seam: forces the next call to rebuild the client after an env change. */
export const resetEmbeddingClient = () => {
    client = null;
};

/**
 * Is this stored vector usable for search right now?
 *
 * Pure and synchronous, so search paths can filter thousands of candidates with no
 * I/O, and so it is directly testable without a database.
 *
 * All four conditions are required, and each one exists because violating it
 * produces a specific failure:
 *
 *   embedding is an array of exactly EMBEDDING_DIMENSIONS finite numbers
 *       — a 32-float legacy vector fails here. So does a truncated write, and so
 *         does a vector containing null/NaN, which would turn every cosine score
 *         into NaN and corrupt the entire ranking, not just that row.
 *   embeddingModel === the active model
 *       — vectors from different models occupy unrelated spaces. Comparing them
 *         is meaningless even at identical dimensions, which text-embedding-3-large
 *         truncated to 1536 would be.
 *   embeddingDimensions === the active dimension count
 *       — cross-checks the stamped metadata against the config, catching a
 *         document written under a different config than the one now running.
 *   embeddingVersion === the active version
 *       — the same model over a different text recipe yields vectors that are
 *         comparable arithmetically but not semantically.
 *
 * A document failing any check is ignored, never deleted: it is still a perfectly
 * good Video or Anime, it just has no valid vector until it is reindexed.
 */
export function isSearchableEmbedding(doc) {
    if (!doc) return false;

    const { embedding, embeddingModel, embeddingDimensions, embeddingVersion } = doc;

    if (!Array.isArray(embedding)) return false;
    if (embedding.length !== EMBEDDING_DIMENSIONS) return false;
    if (embeddingModel !== EMBEDDING_MODEL) return false;
    if (embeddingDimensions !== EMBEDDING_DIMENSIONS) return false;
    if (embeddingVersion !== EMBEDDING_VERSION) return false;

    // Checked last because it is the only O(n) test: cheap scalar comparisons
    // reject the common bad cases first.
    for (let i = 0; i < embedding.length; i += 1) {
        if (typeof embedding[i] !== "number" || !Number.isFinite(embedding[i])) return false;
    }

    return true;
}

/**
 * Why a vector is not searchable, as a short human-readable reason.
 *
 * Used by the backfill's reporting and by diagnostics. Returns null when the
 * vector is fine, so `describeEmbeddingState(doc) ?? "ok"` reads naturally.
 */
export function describeEmbeddingState(doc) {
    if (!doc) return "no document";
    const { embedding, embeddingModel, embeddingDimensions, embeddingVersion } = doc;

    if (!Array.isArray(embedding) || embedding.length === 0) return "missing";
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
        return `wrong dimensions (${embedding.length}, expected ${EMBEDDING_DIMENSIONS})`;
    }
    if (embeddingModel !== EMBEDDING_MODEL) {
        return `wrong model (${embeddingModel || "unset"}, expected ${EMBEDDING_MODEL})`;
    }
    if (embeddingDimensions !== EMBEDDING_DIMENSIONS) {
        return `metadata dimension mismatch (${embeddingDimensions ?? "unset"})`;
    }
    if (embeddingVersion !== EMBEDDING_VERSION) {
        return `wrong version (${embeddingVersion || "unset"}, expected ${EMBEDDING_VERSION})`;
    }
    if (embedding.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
        return "contains non-finite values";
    }
    return null;
}

/**
 * Validates a freshly returned vector before it is allowed anywhere near the
 * database.
 *
 * A provider returning the wrong shape is not a scenario to paper over — writing
 * it would put exactly the kind of mismatched vector this whole module exists to
 * prevent into the collection. So it throws.
 */
const assertFreshVector = (vector) => {
    if (!Array.isArray(vector) || vector.length === 0) {
        throw new EmbeddingValidationError("Embedding provider returned no vector.");
    }
    if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new EmbeddingValidationError(
            `Embedding provider returned ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS} for ${EMBEDDING_MODEL}.`
        );
    }
    if (vector.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
        throw new EmbeddingValidationError("Embedding provider returned non-finite values.");
    }
    return vector;
};

/**
 * Embeds one string and returns the vector together with the metadata that
 * describes it.
 *
 * Returning the identity alongside the vector — rather than leaving callers to
 * remember to stamp it — is what makes an unstamped write hard to do by accident.
 *
 * Throws EmbeddingUnavailableError when unconfigured (never a fake vector) and
 * EmbeddingValidationError on a malformed response. Empty input also throws:
 * an empty vector field is silently unsearchable, and a caller asking to embed
 * nothing has a bug worth surfacing.
 */
export async function generateEmbedding(text) {
    const input = typeof text === "string" ? text.trim() : "";
    if (!input) {
        throw new EmbeddingValidationError("Cannot embed empty text.");
    }

    const response = await getClient().embeddings.create({
        model: EMBEDDING_MODEL,
        input,
    });

    const vector = assertFreshVector(response?.data?.[0]?.embedding);

    return {
        embedding: vector,
        ...activeEmbeddingIdentity(),
        embeddingGeneratedAt: new Date(),
        embeddingTextHash: hashEmbeddingText(input),
    };
}

/**
 * Cosine similarity.
 *
 * Returns null — not 0 — for incomparable input. 0 means "orthogonal", a real and
 * meaningful score that sorts above every negative one; using it to signal "these
 * cannot be compared" is what let mismatched-dimension vectors rank plausibly in
 * the old implementation. null forces a caller to decide explicitly, and a
 * `.filter(s => s !== null)` is a visible decision where a silent 0 was not.
 */
export function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    if (a.length === 0 || a.length !== b.length) return null;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i];
        const y = b[i];
        if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }

    // A zero-magnitude vector has no direction, so the angle is undefined rather
    // than zero. Guarding avoids a 0/0 = NaN leaking into a sort comparator.
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (!magnitude) return null;

    return dot / magnitude;
}

/**
 * The AI subsystem's current state, for /ai/health and the backfill preamble.
 * Contains no secret: whether a key exists, never any part of its value.
 */
export const embeddingStatus = () => ({
    configured: hasEmbeddingProvider(),
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    version: EMBEDDING_VERSION,
});
