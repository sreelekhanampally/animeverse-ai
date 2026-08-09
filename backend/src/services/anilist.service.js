/**
 * AniList GraphQL client.
 *
 * The official public API at https://graphql.anilist.co — no scraping, no HTML
 * parsing, no unofficial endpoints. Nothing here writes to MongoDB; this module
 * only fetches and shapes AniList data, so it can be reused by a script, a job,
 * or (behind auth) a controller without dragging persistence along.
 *
 * Rate limiting, verified against the live API: the response advertises
 * `x-ratelimit-limit: 30` per minute — the docs mention 90, but the header is
 * what is actually enforced, so this client trusts the header and defaults to a
 * conservative floor. Requests are serialised through a single promise chain
 * with a minimum spacing, which is why callers should batch (see fetchAnimeByIds)
 * rather than loop over single-item queries.
 */

const ANILIST_ENDPOINT = process.env.ANILIST_API_URL || "https://graphql.anilist.co";

// AniList allows perPage up to 50. Requesting 50 ids costs ONE request instead of 50.
export const ANILIST_MAX_PER_PAGE = 50;

const MIN_REQUEST_SPACING_MS = Number(process.env.ANILIST_MIN_SPACING_MS || 2200);
const MAX_RETRIES = Number(process.env.ANILIST_MAX_RETRIES || 3);
const REQUEST_TIMEOUT_MS = Number(process.env.ANILIST_TIMEOUT_MS || 20000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serialises every call through one chain. Two callers running concurrently
 * cannot bypass the spacing, which a naive `await sleep()` inside each call
 * would allow. Also tracks the advertised remaining budget so the client can
 * back off *before* being told to.
 */
let queue = Promise.resolve();
let lastRequestAt = 0;
let rateLimitRemaining = null;

const schedule = (task) => {
    const run = queue.then(async () => {
        const waited = Date.now() - lastRequestAt;
        if (waited < MIN_REQUEST_SPACING_MS) {
            await sleep(MIN_REQUEST_SPACING_MS - waited);
        }
        // Nearly out of budget for this window: wait for it to roll over rather
        // than spend the last request and get a 429.
        if (rateLimitRemaining !== null && rateLimitRemaining <= 1) {
            await sleep(60_000);
            rateLimitRemaining = null;
        }
        lastRequestAt = Date.now();
        return task();
    });
    // Keep the chain alive even when one task rejects.
    queue = run.catch(() => {});
    return run;
};

export const getRateLimitRemaining = () => rateLimitRemaining;

/**
 * Executes a GraphQL document. Retries on 429 and 5xx (both transient), honouring
 * `Retry-After` when present; does not retry on GraphQL-level errors such as a
 * bad query or a missing id, since replaying those would just fail identically.
 */
async function anilistRequest(query, variables = {}, attempt = 1) {
    return schedule(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response;
        try {
            response = await fetch(ANILIST_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({ query, variables }),
                signal: controller.signal,
            });
        } catch (error) {
            clearTimeout(timer);
            // Network failure or timeout — worth retrying.
            if (attempt <= MAX_RETRIES) {
                await sleep(1000 * attempt);
                return anilistRequest(query, variables, attempt + 1);
            }
            throw new Error(`AniList request failed: ${error.message}`);
        }
        clearTimeout(timer);

        const remaining = response.headers.get("x-ratelimit-remaining");
        if (remaining !== null) rateLimitRemaining = Number(remaining);

        if (response.status === 429 || response.status >= 500) {
            if (attempt <= MAX_RETRIES) {
                const retryAfter = Number(response.headers.get("retry-after"));
                const backoff = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : 5000 * attempt;
                await sleep(backoff);
                return anilistRequest(query, variables, attempt + 1);
            }
            throw new Error(`AniList responded ${response.status} after ${MAX_RETRIES} retries`);
        }

        const payload = await response.json().catch(() => null);
        if (!payload) throw new Error("AniList returned a non-JSON response");

        if (payload.errors?.length) {
            const message = payload.errors.map((e) => e.message).join("; ");
            throw new Error(`AniList GraphQL error: ${message}`);
        }
        if (!response.ok) throw new Error(`AniList responded ${response.status}`);

        return payload.data;
    });
}

/**
 * The single field selection used everywhere, so a document ingested by id is
 * identical to one ingested by search. `characters` is capped and sorted by role
 * so the main cast comes first instead of an arbitrary slice.
 */
const MEDIA_FIELDS = `
    id
    idMal
    title { romaji english native }
    description(asHtml: false)
    genres
    coverImage { extraLarge large color }
    bannerImage
    episodes
    duration
    season
    seasonYear
    format
    source
    status
    averageScore
    popularity
    isAdult
    siteUrl
    trailer { id site }
    startDate { year }
    studios(isMain: true) { edges { isMain node { id name } } }
    characters(sort: [ROLE, RELEVANCE], perPage: 10) {
        edges { role node { id name { full } image { large } } }
    }
`;

/** One anime by AniList id. Returns null when the id does not exist. */
export async function fetchAnimeById(anilistId) {
    const data = await anilistRequest(
        `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
        { id: Number(anilistId) }
    );
    return data?.Media || null;
}

/**
 * Many anime in as few requests as possible: ids are chunked into pages of 50
 * and each page is a single request. Requesting 50 ids one-by-one would be 50
 * rate-limited round trips; this is one.
 *
 * AniList silently omits ids that do not exist, so the caller can compare what
 * came back against what was asked for to detect bad ids.
 */
export async function fetchAnimeByIds(anilistIds) {
    const ids = [...new Set((anilistIds || []).map(Number).filter(Number.isFinite))];
    const results = [];

    for (let i = 0; i < ids.length; i += ANILIST_MAX_PER_PAGE) {
        const chunk = ids.slice(i, i + ANILIST_MAX_PER_PAGE);
        const data = await anilistRequest(
            `query ($ids: [Int], $perPage: Int) {
                Page(page: 1, perPage: $perPage) {
                    media(id_in: $ids, type: ANIME) { ${MEDIA_FIELDS} }
                }
            }`,
            { ids: chunk, perPage: ANILIST_MAX_PER_PAGE }
        );
        results.push(...(data?.Page?.media || []));
    }

    return results;
}

/**
 * Title search.
 *
 * Caution learned from the live API: SEARCH_MATCH is fuzzy and will happily
 * return something unrelated for a near-miss (searching "Demon Slayer" returns
 * "Onigiri"; "Monster" returns a MUSIC entry). The caller therefore gets the
 * ranked list, not a single "the answer" result, and `limit` defaults to 5 so a
 * human or a heuristic can pick. This is exactly why the seed list is built from
 * verified ids rather than from searches.
 */
export async function searchAnime(query, { limit = 5, includeAdult = false } = {}) {
    const term = String(query || "").trim();
    if (!term) return [];

    const data = await anilistRequest(
        `query ($search: String, $perPage: Int, $isAdult: Boolean) {
            Page(page: 1, perPage: $perPage) {
                media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: $isAdult) {
                    ${MEDIA_FIELDS}
                }
            }
        }`,
        { search: term, perPage: Math.min(limit, ANILIST_MAX_PER_PAGE), isAdult: includeAdult }
    );
    return data?.Page?.media || [];
}

/** Popular anime straight from AniList's own ranking — used to discover real ids. */
export async function fetchPopularAnime({ page = 1, perPage = ANILIST_MAX_PER_PAGE } = {}) {
    const data = await anilistRequest(
        `query ($page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
                pageInfo { total currentPage hasNextPage }
                media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_FIELDS} }
            }
        }`,
        { page, perPage: Math.min(perPage, ANILIST_MAX_PER_PAGE) }
    );
    return {
        media: data?.Page?.media || [],
        hasNextPage: Boolean(data?.Page?.pageInfo?.hasNextPage),
    };
}

/**
 * AniList media -> Anime document shape.
 *
 * Every value is copied from the payload; nothing is invented. Where AniList has
 * no data the field becomes null/""/[] rather than a plausible-looking guess, so
 * "unknown" stays distinguishable from "zero".
 */
export function mapAniListMediaToAnime(media) {
    if (!media?.id) throw new Error("AniList media payload has no id");

    const romaji = media.title?.romaji || "";
    const english = media.title?.english || "";
    const native = media.title?.native || "";

    // AniList sends light HTML (<br>, <i>, <b>) even with asHtml:false. Strip the
    // tags and decode the few entities that actually appear, so the stored value
    // is plain text and safe to render in any context.
    const description = (media.description || "")
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

    return {
        anilistId: media.id,
        malId: media.idMal ?? null,
        title: {
            romaji,
            english,
            native,
            // Guaranteed non-empty: the schema requires `display`, and any of the
            // three upstream titles may individually be null.
            display: english || romaji || native || `AniList #${media.id}`,
        },
        description,
        genres: Array.isArray(media.genres) ? media.genres : [],
        coverImage: {
            // External URLs by design for this phase — AniList images are not
            // downloaded or re-hosted.
            extraLarge: media.coverImage?.extraLarge || "",
            large: media.coverImage?.large || "",
            color: media.coverImage?.color || "",
        },
        bannerImage: media.bannerImage || "",
        episodes: media.episodes ?? null,
        duration: media.duration ?? null,
        season: media.season || null,
        seasonYear: media.seasonYear ?? null,
        format: media.format || null,
        studios: (media.studios?.edges || [])
            .filter((edge) => edge?.isMain !== false)
            .map((edge) => edge?.node?.name)
            .filter(Boolean),
        characters: (media.characters?.edges || [])
            .map((edge) => ({
                anilistId: edge?.node?.id ?? null,
                name: edge?.node?.name?.full || "",
                role: edge?.role || "",
                image: edge?.node?.image?.large || "",
            }))
            .filter((character) => character.name),
        source: media.source || null,
        status: media.status || null,
        averageScore: media.averageScore ?? null,
        popularity: media.popularity ?? 0,
        isAdult: Boolean(media.isAdult),
        siteUrl: media.siteUrl || "",
        trailer: {
            id: media.trailer?.id || "",
            site: media.trailer?.site || "",
        },
        startYear: media.startDate?.year ?? null,
        metadataSource: "anilist",
        lastSyncedAt: new Date(),
    };
}
