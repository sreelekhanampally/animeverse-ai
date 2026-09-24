import { normalizeSearchText, tokenizeSearchText } from "./semanticRanking.js";

export const RRF_K = 60;
export const RAG_MIN_LEXICAL_COVERAGE = 0.3;
export const RAG_MIN_SEMANTIC_SIMILARITY = 0.18;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const QUESTION_WORDS = new Set([
    "about", "by", "can", "could", "did", "do", "does", "her", "his", "how",
    "its", "me", "my", "our", "please", "should", "their", "them", "these",
    "those", "what", "when", "where", "which", "who", "why", "would", "you", "your",
]);

export const lexicalCoverageScore = (query, chunk) => {
    const queryTokens = [...new Set(tokenizeSearchText(query).filter((token) => !QUESTION_WORDS.has(token)))];
    if (!queryTokens.length) return 0;

    const title = normalizeSearchText(chunk?.title);
    const content = normalizeSearchText(chunk?.content);
    const haystackTokens = new Set(tokenizeSearchText(`${title} ${content}`));

    const matched = queryTokens.filter((token) => haystackTokens.has(token)).length;
    let score = matched / queryTokens.length;

    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery && title.includes(normalizedQuery)) score += 0.3;
    else if (normalizedQuery && content.includes(normalizedQuery)) score += 0.15;

    return Number(clamp01(score).toFixed(6));
};

export const reciprocalRank = (rank, k = RRF_K) =>
    Number.isInteger(rank) && rank > 0 ? 1 / (k + rank) : 0;

export function fuseRankings(vectorResults = [], lexicalResults = []) {
    const byId = new Map();

    const touch = (chunk) => {
        const id = String(chunk?._id || "");
        if (!id) return null;
        if (!byId.has(id)) {
            byId.set(id, {
                chunk,
                vectorRank: null,
                lexicalRank: null,
                semanticScore: 0,
                mongoTextScore: 0,
            });
        }
        return byId.get(id);
    };

    vectorResults.forEach((row, index) => {
        const entry = touch(row.chunk || row);
        if (!entry) return;
        entry.vectorRank = index + 1;
        entry.semanticScore = Number(row.semanticScore ?? row.score ?? 0);
    });

    lexicalResults.forEach((row, index) => {
        const entry = touch(row.chunk || row);
        if (!entry) return;
        entry.lexicalRank = index + 1;
        entry.mongoTextScore = Number(row.mongoTextScore ?? row.score ?? 0);
    });

    return [...byId.values()].map((entry) => {
        const vectorRrf = reciprocalRank(entry.vectorRank);
        const lexicalRrf = reciprocalRank(entry.lexicalRank);
        const rrfScore = 0.68 * vectorRrf + 0.32 * lexicalRrf;
        return { ...entry, rrfScore };
    });
}

export function rerankRagResults(query, fused = []) {
    return fused
        .map((entry) => {
            const lexicalScore = lexicalCoverageScore(query, entry.chunk);
            const normalizedRrf = clamp01(entry.rrfScore * (RRF_K + 1));
            const semantic = clamp01((Number(entry.semanticScore) + 1) / 2);

            const sourceBoost =
                entry.chunk?.sourceType === "anime_metadata"
                    ? 0.03
                    : entry.chunk?.sourceType === "video_metadata"
                      ? 0.02
                      : 0;

            const score = clamp01(
                0.52 * semantic + 0.27 * lexicalScore + 0.18 * normalizedRrf + sourceBoost
            );

            return {
                ...entry,
                lexicalScore,
                normalizedRrf: Number(normalizedRrf.toFixed(6)),
                score: Number(score.toFixed(6)),
            };
        })
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore;
            return String(a.chunk?._id || "").localeCompare(String(b.chunk?._id || ""));
        });
}

// A vector neighbour alone is not evidence for a factual answer. Require one
// selected chunk to agree on both whole query words and semantic similarity.
// The thresholds are conservative for factual RAG and should be checked against
// the evaluation corpus when the indexed catalogue changes.
export const hasRagEvidence = (selected = []) =>
    selected.some((entry) =>
        Number(entry.lexicalScore) >= RAG_MIN_LEXICAL_COVERAGE &&
        Number(entry.semanticScore) >= RAG_MIN_SEMANTIC_SIMILARITY
    );

export const ragRankingInternals = { clamp01 };
