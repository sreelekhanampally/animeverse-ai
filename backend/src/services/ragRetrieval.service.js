import { RagChunk } from "../models/ragChunk.model.js";
import {
    RAG_INDEX_VERSION,
    RAG_LEXICAL_WEIGHT,
    RAG_MAX_VECTOR_CANDIDATES,
    RAG_TITLE_WEIGHT,
    RAG_VECTOR_WEIGHT,
} from "../config/rag.config.js";
import {
    cosineSimilarity,
    generateEmbedding,
    isSearchableEmbedding,
} from "./embedding.service.js";

const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingGeneratedAt +embeddingTextHash";

const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
    "it", "of", "on", "or", "that", "the", "this", "to", "with", "show", "find",
    "video", "videos", "anime", "about", "me", "my", "please",
]);

const normalize = (value) =>
    String(value ?? "")
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

export function tokenizeRagText(value) {
    return normalize(value)
        .split(/\s+/)
        .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

const countTerms = (tokens) => {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return counts;
};

export function bm25LexicalScores(query, documents = []) {
    const queryTerms = [...new Set(tokenizeRagText(query))];
    const scores = new Map();
    if (!queryTerms.length || !documents.length) return scores;

    const rows = documents.map((doc) => {
        const tokens = tokenizeRagText(`${doc.sourceTitle || ""} ${doc.text || ""}`);
        return { key: doc.chunkKey, tokens, counts: countTerms(tokens) };
    });

    const avgdl =
        rows.reduce((sum, row) => sum + Math.max(1, row.tokens.length), 0) / Math.max(1, rows.length);
    const df = new Map();
    for (const term of queryTerms) {
        df.set(
            term,
            rows.reduce((count, row) => count + (row.counts.has(term) ? 1 : 0), 0)
        );
    }

    const k1 = 1.2;
    const b = 0.75;
    let maxScore = 0;

    for (const row of rows) {
        const dl = Math.max(1, row.tokens.length);
        let score = 0;
        for (const term of queryTerms) {
            const tf = row.counts.get(term) || 0;
            if (!tf) continue;
            const termDf = df.get(term) || 0;
            const idf = Math.log(1 + (rows.length - termDf + 0.5) / (termDf + 0.5));
            const denom = tf + k1 * (1 - b + b * (dl / avgdl));
            score += idf * ((tf * (k1 + 1)) / denom);
        }
        scores.set(row.key, score);
        maxScore = Math.max(maxScore, score);
    }

    if (maxScore > 0) {
        for (const [key, value] of scores) scores.set(key, value / maxScore);
    }

    return scores;
}

const titleAffinity = (query, title) => {
    const q = normalize(query);
    const t = normalize(title);
    if (!q || !t) return 0;
    if (q.includes(t) || t.includes(q)) return 1;

    const qTokens = new Set(tokenizeRagText(q));
    const tTokens = tokenizeRagText(t);
    if (!qTokens.size || !tTokens.length) return 0;
    const overlap = tTokens.filter((token) => qTokens.has(token)).length;
    return Math.min(1, overlap / Math.max(1, Math.min(qTokens.size, tTokens.length)));
};

const queryCoverage = (query, doc) => {
    const terms = [...new Set(tokenizeRagText(query))];
    if (!terms.length) return 0;
    const tokens = new Set(tokenizeRagText(`${doc.sourceTitle || ""} ${doc.text || ""}`));
    return terms.filter((term) => tokens.has(term)).length / terms.length;
};

const sectionBonus = (section) => {
    if (section === "identity") return 0.025;
    if (section === "synopsis") return 0.02;
    if (section === "metadata") return 0.015;
    if (section === "creator_transcript") return 0.01;
    return 0;
};

export function rerankRagCandidates(query, candidates = []) {
    return candidates
        .map((candidate) => {
            const coverage = queryCoverage(query, candidate);
            const rerankScore =
                candidate.hybridScore +
                coverage * 0.04 +
                sectionBonus(candidate.section);

            return {
                ...candidate,
                queryCoverage: Number(coverage.toFixed(6)),
                score: Number(rerankScore.toFixed(6)),
            };
        })
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore;
            return String(a.chunkKey).localeCompare(String(b.chunkKey));
        });
}

const publicChunk = (chunk) => {
    const clean = { ...chunk };
    delete clean.embedding;
    delete clean.embeddingModel;
    delete clean.embeddingDimensions;
    delete clean.embeddingVersion;
    delete clean.embeddingGeneratedAt;
    delete clean.embeddingTextHash;
    return clean;
};

export async function retrieveRagKnowledge(
    query,
    {
        limit = 8,
        maxCandidates = RAG_MAX_VECTOR_CANDIDATES,
        sourceTypes = [],
    } = {}
) {
    const input = String(query ?? "").trim();
    if (input.length < 2) {
        const error = new Error("RAG query must contain at least 2 characters");
        error.statusCode = 400;
        throw error;
    }

    const safeLimit = Math.min(20, Math.max(1, Number(limit) || 8));
    const safeCandidates = Math.min(20_000, Math.max(safeLimit, Number(maxCandidates) || 6_000));
    const { embedding: queryEmbedding } = await generateEmbedding(input);

    const filter = {
        isActive: true,
        indexVersion: RAG_INDEX_VERSION,
    };
    if (Array.isArray(sourceTypes) && sourceTypes.length) {
        filter.sourceType = { $in: sourceTypes };
    }

    const docs = await RagChunk.find(filter)
        .select(
            `${EMBEDDING_FIELDS} chunkKey sourceType sourceCollection sourceId sourceTitle section chunkIndex text metadata indexVersion contentHash isActive`
        )
        .limit(safeCandidates)
        .lean();

    const lexical = bm25LexicalScores(input, docs);
    const candidates = [];
    let skippedEmbeddings = 0;

    for (const doc of docs) {
        if (!isSearchableEmbedding(doc)) {
            skippedEmbeddings += 1;
            continue;
        }

        const cosine = cosineSimilarity(queryEmbedding, doc.embedding);
        if (cosine === null) {
            skippedEmbeddings += 1;
            continue;
        }

        const vectorScore = Math.max(0, Math.min(1, cosine));
        const lexicalScore = lexical.get(doc.chunkKey) || 0;
        const titleScore = titleAffinity(input, doc.sourceTitle);
        const hybridScore =
            vectorScore * RAG_VECTOR_WEIGHT +
            lexicalScore * RAG_LEXICAL_WEIGHT +
            titleScore * RAG_TITLE_WEIGHT;

        candidates.push({
            ...publicChunk(doc),
            vectorScore: Number(vectorScore.toFixed(6)),
            lexicalScore: Number(lexicalScore.toFixed(6)),
            titleScore: Number(titleScore.toFixed(6)),
            hybridScore: Number(hybridScore.toFixed(6)),
        });
    }

    const ranked = rerankRagCandidates(input, candidates);

    return {
        query: input,
        results: ranked.slice(0, safeLimit),
        diagnostics: {
            indexVersion: RAG_INDEX_VERSION,
            candidateChunks: docs.length,
            searchableChunks: candidates.length,
            skippedEmbeddings,
            vectorWeight: RAG_VECTOR_WEIGHT,
            lexicalWeight: RAG_LEXICAL_WEIGHT,
            titleWeight: RAG_TITLE_WEIGHT,
        },
    };
}

export const ragRetrievalInternals = { normalize, titleAffinity, queryCoverage };
