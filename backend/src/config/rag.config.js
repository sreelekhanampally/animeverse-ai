const asInt = (value, fallback, min, max) => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

export const RAG_INDEX_VERSION = "rag-v1";
export const RAG_CHUNK_MAX_CHARS = asInt(process.env.RAG_CHUNK_MAX_CHARS, 900, 300, 2_000);
export const RAG_CHUNK_OVERLAP_CHARS = asInt(process.env.RAG_CHUNK_OVERLAP_CHARS, 120, 0, 400);
export const RAG_MAX_VECTOR_CANDIDATES = asInt(
    process.env.RAG_MAX_VECTOR_CANDIDATES,
    6_000,
    500,
    20_000
);
export const RAG_MAX_CONTEXT_CHARS = asInt(process.env.RAG_MAX_CONTEXT_CHARS, 8_000, 2_000, 20_000);
export const RAG_MAX_CHUNKS_PER_SOURCE = asInt(
    process.env.RAG_MAX_CHUNKS_PER_SOURCE,
    2,
    1,
    5
);

export const RAG_VECTOR_WEIGHT = 0.72;
export const RAG_LEXICAL_WEIGHT = 0.23;
export const RAG_TITLE_WEIGHT = 0.05;
