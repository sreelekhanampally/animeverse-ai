/**
 * Jikan REST API client used only as a metadata fallback when AniList is down.
 *
 * Jikan exposes public MyAnimeList data without an API key. AnimeVerse keeps this
 * client deliberately small: catalogue growth needs only the popularity ranking
 * and the metadata already included in those results. We do NOT crawl episode
 * pages, reviews, recommendations, staff, or every related resource.
 *
 * Public-service limits are respected conservatively. Jikan documents 3 req/s
 * and 60 req/min; a ~1.1s floor stays under both limits even if a run lasts a
 * full minute. 429/5xx responses receive bounded backoff, never an infinite
 * retry loop.
 */

const JIKAN_API_BASE = process.env.JIKAN_API_URL || "https://api.jikan.moe/v4";
const MIN_REQUEST_SPACING_MS = Number(process.env.JIKAN_MIN_SPACING_MS || 1100);
const MAX_RETRIES = Number(process.env.JIKAN_MAX_RETRIES || 4);
const REQUEST_TIMEOUT_MS = Number(process.env.JIKAN_TIMEOUT_MS || 20000);

export const JIKAN_MAX_PER_PAGE = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

const waitForSpacing = async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < MIN_REQUEST_SPACING_MS) {
        await sleep(MIN_REQUEST_SPACING_MS - elapsed);
    }
};

const retryDelayMs = (response, attempt) => {
    const retryAfter = Number(response?.headers?.get?.("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter * 1000, 15000);
    }
    return Math.min(1200 * 2 ** attempt, 12000);
};

export class JikanApiError extends Error {
    constructor(message, { status = null, retryable = false } = {}) {
        super(message);
        this.name = "JikanApiError";
        this.status = status;
        this.retryable = retryable;
    }
}

async function jikanRequest(pathname, params = {}) {
    const url = new URL(`${JIKAN_API_BASE.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }

    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        await waitForSpacing();

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;

        try {
            response = await fetch(url, {
                headers: {
                    Accept: "application/json",
                    "User-Agent": "AnimeVerse-AI/1.0 metadata-fallback",
                },
                signal: controller.signal,
            });
            lastRequestAt = Date.now();
        } catch (error) {
            clearTimeout(timer);
            lastError = new JikanApiError(`Jikan request failed: ${error.message}`, {
                retryable: true,
            });
            if (attempt < MAX_RETRIES) {
                await sleep(Math.min(1200 * 2 ** attempt, 12000));
                continue;
            }
            throw lastError;
        }
        clearTimeout(timer);

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            // A non-JSON error page is handled below using the HTTP status.
        }

        if (response.ok) {
            if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) {
                throw new JikanApiError("Jikan returned a malformed response", {
                    status: response.status,
                    retryable: false,
                });
            }
            return payload;
        }

        const message =
            payload?.message || payload?.error || `HTTP ${response.status}`;
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new JikanApiError(
            `Jikan API error (${response.status}): ${message}`,
            { status: response.status, retryable }
        );

        if (!retryable || attempt >= MAX_RETRIES) throw lastError;
        await sleep(retryDelayMs(response, attempt));
    }

    throw lastError || new JikanApiError("Jikan request failed");
}

/**
 * Fetches a popularity-ranked, safe-for-work slice from Jikan.
 *
 * `filter=bypopularity` is important: plain `/top/anime` is score-ranked, while
 * AnimeVerse catalogue growth wants recognisable/famous titles first. The API
 * returns at most 25 rows per page, so 160 titles cost only seven metadata calls.
 */
export async function fetchPopularAnimeFromJikan({ limit = 160 } = {}) {
    const wanted = Math.max(1, Math.min(Number(limit) || 160, 500));
    const collected = [];
    const seenMalIds = new Set();
    const pageSize = Math.min(JIKAN_MAX_PER_PAGE, wanted);
    let page = 1;

    while (collected.length < wanted) {
        const payload = await jikanRequest("top/anime", {
            filter: "bypopularity",
            sfw: "true",
            page,
            limit: pageSize,
        });

        for (const item of payload.data || []) {
            const malId = Number(item?.mal_id);
            if (!Number.isFinite(malId) || malId <= 0 || seenMalIds.has(malId)) continue;
            seenMalIds.add(malId);
            collected.push(item);
            if (collected.length >= wanted) break;
        }

        if (!payload?.pagination?.has_next_page || !(payload.data || []).length) break;
        page += 1;
    }

    return collected.slice(0, wanted);
}

/**
 * Anime.anilistId is historically required and uniquely indexed in this project.
 * Jikan only gives us a MyAnimeList id, so fallback-only documents receive a
 * deterministic negative surrogate. AniList ids are positive, therefore the two
 * namespaces cannot collide. If AniList later returns, animeIngest promotes the
 * same document by matching malId and replacing this surrogate with the real id.
 */
export function jikanSyntheticAniListId(malId) {
    const id = Number(malId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error("Jikan anime payload has no valid mal_id");
    }
    return -id;
}

const FORMAT_MAP = new Map([
    ["TV", "TV"],
    ["TV Special", "SPECIAL"],
    ["Movie", "MOVIE"],
    ["Special", "SPECIAL"],
    ["OVA", "OVA"],
    ["ONA", "ONA"],
    ["Music", "MUSIC"],
]);

const STATUS_MAP = new Map([
    ["Finished Airing", "FINISHED"],
    ["Currently Airing", "RELEASING"],
    ["Not yet aired", "NOT_YET_RELEASED"],
]);

const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const cleanText = (value) =>
    String(value || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();


export function parseJikanDurationMinutes(value) {
    const text = String(value || "").toLowerCase().trim();
    if (!text || text === "unknown") return null;

    const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*hr/)?.[1] || 0);
    const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*min/)?.[1] || 0);
    const total = hours * 60 + minutes;
    return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

const normaliseSource = (source) => {
    const text = String(source || "").trim();
    if (!text) return null;
    return text.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
};

/** Jikan top-anime payload -> the existing Anime model shape. */
export function mapJikanAnimeToAnime(item) {
    const malId = Number(item?.mal_id);
    const syntheticAniListId = jikanSyntheticAniListId(malId);

    const romaji = String(item?.title || "").trim();
    const english = String(item?.title_english || "").trim();
    const native = String(item?.title_japanese || "").trim();
    const display = english || romaji || native || `MyAnimeList #${malId}`;

    const jpg = item?.images?.jpg || {};
    const webp = item?.images?.webp || {};
    const largeImage = webp.large_image_url || jpg.large_image_url || webp.image_url || jpg.image_url || "";
    const mediumImage = webp.image_url || jpg.image_url || largeImage;

    const score = Number(item?.score);
    const members = Number(item?.members);
    const rating = String(item?.rating || "");
    const season = String(item?.season || "").toUpperCase();
    const trailerId = String(item?.trailer?.youtube_id || "").trim();

    return {
        anilistId: syntheticAniListId,
        malId,
        title: { romaji, english, native, display },
        description: cleanText(item?.synopsis || item?.background || ""),
        genres: Array.isArray(item?.genres)
            ? item.genres.map((genre) => genre?.name).filter(Boolean)
            : [],
        coverImage: {
            extraLarge: largeImage,
            large: mediumImage,
            color: "",
        },
        bannerImage: "",
        episodes: numberOrNull(item?.episodes),
        duration: parseJikanDurationMinutes(item?.duration),
        season: ["WINTER", "SPRING", "SUMMER", "FALL"].includes(season) ? season : null,
        seasonYear: numberOrNull(item?.year),
        format: FORMAT_MAP.get(item?.type) || null,
        studios: Array.isArray(item?.studios)
            ? item.studios.map((studio) => studio?.name).filter(Boolean)
            : [],
        // The popularity ranking endpoint does not include character edges.
        // Leaving this empty is truthful and avoids N extra requests per anime.
        characters: [],
        source: normaliseSource(item?.source),
        status: STATUS_MAP.get(item?.status) || null,
        averageScore: Number.isFinite(score) && score > 0 ? Math.round(score * 10) : null,
        // AnimeVerse sorts descending. MAL's `popularity` is a rank where 1 is
        // best, so `members` is used instead because higher genuinely means more
        // popular and is comparable to AniList's popularity-count semantics.
        popularity: Number.isFinite(members) && members > 0 ? members : 0,
        isAdult: /hentai/i.test(rating),
        siteUrl: String(item?.url || ""),
        trailer: {
            id: trailerId,
            site: trailerId ? "youtube" : "",
        },
        startYear:
            Number(item?.aired?.prop?.from?.year) ||
            numberOrNull(item?.year),
        metadataSource: "jikan",
        lastSyncedAt: new Date(),
    };
}
