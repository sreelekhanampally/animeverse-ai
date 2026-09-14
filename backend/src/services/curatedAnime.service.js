/**
 * Pure helpers for the offline curated Anime fallback.
 *
 * No network calls live here. The generated documents intentionally contain only
 * facts supplied by the local seed: identity title + provenance. Everything else
 * is left unknown so the fallback cannot fabricate synopsis/genres/studios/year.
 */

export function normalizeCuratedTitle(value) {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[’'`]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Stable FNV-1a based id inside a reserved negative namespace.
 * Jikan fallback ids are `-malId` (small negatives); curated ids live below
 * -2,000,000,000 so the namespaces cannot collide in practice.
 */
export function curatedSyntheticAniListId(key) {
    const text = String(key || "").trim();
    if (!text) throw new Error("Curated anime seed requires a stable key");

    let hash = 0x811c9dc5;
    for (const char of text) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return -(2_000_000_000 + (hash % 500_000_000));
}

export function curatedTitleKeys(seed) {
    const values = [seed?.title, ...(Array.isArray(seed?.aliases) ? seed.aliases : [])];
    return new Set(values.map(normalizeCuratedTitle).filter(Boolean));
}

export function mapCuratedSeedToAnime(seed, { rank = 0 } = {}) {
    const title = String(seed?.title || "").trim();
    if (!title) throw new Error("Curated anime seed requires a title");

    return {
        anilistId: curatedSyntheticAniListId(seed.key),
        malId: null,
        title: {
            romaji: title,
            english: title,
            native: "",
            display: title,
        },
        description: "",
        genres: [],
        coverImage: { extraLarge: "", large: "", color: "" },
        bannerImage: "",
        episodes: null,
        duration: null,
        season: null,
        seasonYear: null,
        format: null,
        studios: [],
        characters: [],
        source: null,
        status: null,
        averageScore: null,
        // Deterministic ordering only. This is not presented as an upstream
        // popularity statistic; it simply keeps earlier curated titles first.
        popularity: Math.max(1, 1_000_000 - Number(rank || 0)),
        isAdult: false,
        siteUrl: "",
        trailer: { id: "", site: "" },
        startYear: null,
        metadataSource: "curated",
        lastSyncedAt: new Date(),
    };
}
