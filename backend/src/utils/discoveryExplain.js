import { normalizeSearchText, tokenizeSearchText } from "./semanticRanking.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const uniqueNormalized = (values = []) =>
    [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeSearchText(value)).filter(Boolean))];

export const sharedValues = (left = [], right = []) => {
    const a = uniqueNormalized(left);
    const b = new Set(uniqueNormalized(right));
    return a.filter((value) => b.has(value));
};

export const overlapRatio = (left = [], right = []) => {
    const a = uniqueNormalized(left);
    const b = uniqueNormalized(right);
    if (!a.length || !b.length) return 0;
    const intersection = a.filter((value) => b.includes(value)).length;
    return Number((intersection / Math.max(a.length, b.length)).toFixed(6));
};

export function combineSimilarityScore({ semantic, sameAnime = 0, genreOverlap = 0, metadataOverlap = 0 }) {
    const score =
        0.82 * clamp01(semantic) +
        0.1 * clamp01(sameAnime) +
        0.05 * clamp01(genreOverlap) +
        0.03 * clamp01(metadataOverlap);
    return Number(score.toFixed(6));
}

const labelCase = (value) =>
    String(value || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");

export function explainSimilarityMatch(sourceVideo, candidateVideo, semanticScore) {
    const reasons = [];
    const sourceAnime = sourceVideo?.anime || null;
    const candidateAnime = candidateVideo?.anime || null;
    const sourceAnimeId = String(sourceAnime?._id || sourceAnime || "");
    const candidateAnimeId = String(candidateAnime?._id || candidateAnime || "");

    if (sourceAnimeId && candidateAnimeId && sourceAnimeId === candidateAnimeId) {
        reasons.push("Same anime");
    }

    const genres = sharedValues(sourceAnime?.genres, candidateAnime?.genres).slice(0, 2);
    if (genres.length) reasons.push(`Shared genre: ${genres.map(labelCase).join(", ")}`);

    if (semanticScore >= 0.55) reasons.push("Very similar theme");
    else if (semanticScore >= 0.32) reasons.push("Similar themes");
    else if (semanticScore > 0) reasons.push("Related theme");

    const tags = sharedValues(sourceVideo?.tags, candidateVideo?.tags).slice(0, 2);
    if (tags.length) reasons.push(`Shared tag: ${tags.map(labelCase).join(", ")}`);

    const sameCategory =
        normalizeSearchText(sourceVideo?.category) &&
        normalizeSearchText(sourceVideo?.category) === normalizeSearchText(candidateVideo?.category) &&
        normalizeSearchText(sourceVideo?.category) !== "general";
    if (sameCategory) reasons.push(`Same category: ${sourceVideo.category}`);

    return reasons.slice(0, 3);
}

export function explainSearchMatch(query, result) {
    const reasons = [];
    const video = result?.video || {};
    const anime = video?.anime || {};
    const queryTokens = new Set(tokenizeSearchText(query));

    const titleTokens = tokenizeSearchText(video?.title);
    const animeTitleTokens = Object.values(anime?.title || {}).flatMap(tokenizeSearchText);
    const characterTokens = (anime?.characters || []).flatMap((character) => tokenizeSearchText(character?.name));
    const genres = uniqueNormalized(anime?.genres || []);

    if (titleTokens.some((token) => queryTokens.has(token))) reasons.push("Title match");
    if (animeTitleTokens.some((token) => queryTokens.has(token))) reasons.push("Anime title match");
    if (characterTokens.some((token) => queryTokens.has(token))) reasons.push("Character match");

    const genreMatches = genres.filter((genre) => tokenizeSearchText(genre).some((token) => queryTokens.has(token)));
    if (genreMatches.length) reasons.push(`Genre match: ${genreMatches.slice(0, 2).map(labelCase).join(", ")}`);

    if ((result?.animeScore || 0) >= 0.35) reasons.push("Story/details match");
    if ((result?.semanticScore || 0) >= 0.4) reasons.push("Similar theme");
    else if ((result?.semanticScore || 0) > 0) reasons.push("Related theme");

    if (!reasons.length && (result?.score || 0) > 0) reasons.push("Close overall match");
    return [...new Set(reasons)].slice(0, 3);
}
