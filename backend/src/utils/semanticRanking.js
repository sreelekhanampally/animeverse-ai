const WORD_RE = /[\p{L}\p{N}]+/gu;
const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "for", "from", "in", "is", "of", "on", "or", "the", "to", "vs", "with"]);

export const normalizeSearchText = (value) =>
    String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/g, " ");

export const tokenizeSearchText = (value) => {
    const normalized = normalizeSearchText(value);
    return normalized.match(WORD_RE)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [];
};

const titleVariants = (anime) => {
    const title = anime?.title || {};
    return [title.display, title.english, title.romaji, title.native]
        .map(normalizeSearchText)
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index);
};

const phraseMatches = (query, candidate) => {
    if (!query || !candidate) return false;
    return candidate.includes(query) || (candidate.length >= 3 && query.includes(candidate));
};

/**
 * Lightweight lexical signal used only as a tie-break/boost beside embeddings.
 * It is intentionally bounded to [0, 1] so it can never swamp semantic scores.
 */
export function lexicalMatchScore(query, video, anime = null) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return 0;

    const queryTokens = [...new Set(tokenizeSearchText(normalizedQuery))];
    const videoTitle = normalizeSearchText(video?.title);
    const animeTitles = titleVariants(anime);

    const searchable = normalizeSearchText(
        [
            video?.title,
            video?.description,
            ...(Array.isArray(video?.tags) ? video.tags : []),
            video?.category,
            ...animeTitles,
            ...(Array.isArray(anime?.genres) ? anime.genres : []),
            ...(Array.isArray(anime?.studios) ? anime.studios : []),
            ...(Array.isArray(anime?.characters)
                ? anime.characters.map((character) => character?.name)
                : []),
        ]
            .filter(Boolean)
            .join(" ")
    );

    let score = 0;
    if (phraseMatches(normalizedQuery, videoTitle)) score += 0.25;
    if (animeTitles.some((title) => phraseMatches(normalizedQuery, title))) score += 0.45;

    const queryTokenSet = new Set(queryTokens);
    const videoTitleTokens = tokenizeSearchText(videoTitle);
    const animeTitleTokens = animeTitles.flatMap(tokenizeSearchText);
    if (videoTitleTokens.some((token) => queryTokenSet.has(token))) score += 0.1;
    if (animeTitleTokens.some((token) => queryTokenSet.has(token))) score += 0.2;

    if (queryTokens.length) {
        const matched = queryTokens.filter((token) => searchable.includes(token)).length;
        score += 0.3 * (matched / queryTokens.length);
    }

    return Math.min(1, Number(score.toFixed(6)));
}

const positiveCosine = (value) =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/**
 * Blends direct video semantics with linked-Anime semantics and a small lexical
 * signal. There is deliberately no hard minimum score: low-but-correct matches
 * (for example sparse metadata) should still be allowed to rank.
 */
export function combineRetrievalScores({ videoSemantic, animeSemantic, lexical }) {
    const direct = positiveCosine(videoSemantic);
    const linkedAnime = positiveCosine(animeSemantic);
    const lexicalSignal = Math.max(0, Math.min(1, Number(lexical) || 0));

    const score = 0.62 * direct + 0.23 * linkedAnime + 0.15 * lexicalSignal;
    return Number(score.toFixed(6));
}

export function compareRankedResults(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.lexicalScore || 0) !== (a.lexicalScore || 0)) {
        return (b.lexicalScore || 0) - (a.lexicalScore || 0);
    }
    if ((b.semanticScore || 0) !== (a.semanticScore || 0)) {
        return (b.semanticScore || 0) - (a.semanticScore || 0);
    }
    return String(a.video?._id || a._id || "").localeCompare(
        String(b.video?._id || b._id || "")
    );
}
