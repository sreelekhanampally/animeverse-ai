/**
 * YouTube Data API v3 client.
 *
 * Official API only — https://www.googleapis.com/youtube/v3. Nothing here fetches
 * a watch page, parses HTML, resolves a stream URL, or downloads media. The only
 * thing ingestion ever keeps is the 11-character video ID, which the existing
 * Phase 1 player hands to YouTube's own embed.
 *
 * The API key is read from the environment on the server and never leaves it: no
 * function here returns the key, logs it, or puts it in a document.
 *
 * Quota is the real constraint, not rate limiting. On the default 10,000 units/day:
 *   search.list  = 100 units  (expensive)
 *   videos.list  =   1 unit   (cheap, and accepts 50 ids per call)
 * So 1 search costs as much as 100 detail lookups. Everything below is shaped
 * around minimising searches and batching detail lookups.
 */

const YOUTUBE_API_BASE = process.env.YOUTUBE_API_BASE || "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = Number(process.env.YOUTUBE_TIMEOUT_MS || 20000);

// videos.list accepts up to 50 ids per request — one unit for fifty videos.
export const YOUTUBE_MAX_IDS_PER_CALL = 50;

// Documented quota costs, used only for the run's cost estimate in the CLI output.
export const QUOTA_COST = { search: 100, videos: 1 };

/**
 * Thrown when the API reports quota exhaustion. A distinct class so the ingestion
 * can stop the whole run cleanly instead of treating it as one bad video — the
 * brief explicitly wants no aggressive retries against an exhausted quota.
 */
export class YouTubeQuotaError extends Error {
    constructor(message = "YouTube API quota appears exhausted. No further requests will be made.") {
        super(message);
        this.name = "YouTubeQuotaError";
        this.isQuotaError = true;
    }
}

/** Thrown for configuration problems — a missing or rejected key. Also fatal. */
export class YouTubeConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "YouTubeConfigError";
        this.isConfigError = true;
    }
}

export const hasYouTubeApiKey = () => Boolean(process.env.YOUTUBE_API_KEY?.trim());

const getApiKey = () => {
    const key = process.env.YOUTUBE_API_KEY?.trim();
    if (!key) {
        throw new YouTubeConfigError("YouTube API key is required for YouTube ingestion.");
    }
    return key;
};

/** Simple counters so the CLI can report how much quota a run actually spent. */
const usage = { search: 0, videos: 0, quotaUnits: 0 };
export const getQuotaUsage = () => ({ ...usage });
export const resetQuotaUsage = () => {
    usage.search = 0;
    usage.videos = 0;
    usage.quotaUnits = 0;
};

/**
 * One GET against the API.
 *
 * Error mapping is deliberate: 403 with a quota/rateLimit reason and 429 become
 * fatal QuotaErrors (stop the run), a rejected key becomes a fatal ConfigError,
 * and everything else becomes an ordinary Error the caller can treat as a
 * per-item failure. No retry loop — retrying an exhausted quota just burns time,
 * and retrying a bad key can never succeed.
 */
async function youtubeRequest(endpoint, params) {
    const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }
    url.searchParams.set("key", getApiKey());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
    } catch (error) {
        clearTimeout(timer);
        throw new Error(`YouTube request failed (${endpoint}): ${error.message}`);
    }
    clearTimeout(timer);

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        // Fall through — handled as a malformed response below.
    }

    if (!response.ok) {
        const apiError = payload?.error;
        const reason = apiError?.errors?.[0]?.reason || "";
        const message = apiError?.message || `HTTP ${response.status}`;

        if (response.status === 429 || ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason)) {
            throw new YouTubeQuotaError();
        }
        if (response.status === 400 && /API key not valid/i.test(message)) {
            throw new YouTubeConfigError(
                "YouTube API key was rejected by Google (invalid key). Check YOUTUBE_API_KEY."
            );
        }
        if (response.status === 403) {
            // 403 without a quota reason is usually a disabled API or a key
            // restricted to other referrers/IPs — a configuration problem.
            throw new YouTubeConfigError(
                `YouTube API returned 403 (${reason || "forbidden"}): ${message}`
            );
        }
        throw new Error(`YouTube API error on ${endpoint} (${response.status}): ${message}`);
    }

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
        throw new Error(`YouTube API returned a malformed response for ${endpoint}`);
    }

    return payload;
}

/**
 * search.list — discovery only.
 *
 * Returns just the ids plus the snippet fields needed for logging. Search
 * snippets are deliberately NOT trusted as the final metadata: they omit
 * duration, embeddable and privacyStatus, and the brief requires a videos.list
 * confirmation for every candidate.
 *
 * `videoEmbeddable=true` and `videoSyndicated=true` are passed so YouTube filters
 * out non-embeddable videos server-side, before they cost us anything.
 */
export async function searchVideos(query, { maxResults = 10, order = "relevance", regionCode } = {}) {
    const payload = await youtubeRequest("search", {
        part: "snippet",
        type: "video",
        q: query,
        maxResults: Math.min(Math.max(Number(maxResults) || 10, 1), 50),
        order,
        safeSearch: "moderate",
        videoEmbeddable: "true",
        videoSyndicated: "true",
        regionCode,
    });

    usage.search += 1;
    usage.quotaUnits += QUOTA_COST.search;

    return (payload.items || [])
        .map((item) => ({
            videoId: item?.id?.videoId || null,
            title: item?.snippet?.title || "",
            channelTitle: item?.snippet?.channelTitle || "",
            channelId: item?.snippet?.channelId || "",
            publishedAt: item?.snippet?.publishedAt || null,
        }))
        .filter((item) => item.videoId);
}

/**
 * videos.list — authoritative metadata for ids already discovered.
 *
 * Batched 50 at a time: fetching 50 videos costs 1 quota unit here versus 50
 * separate calls. Ids YouTube does not return (deleted, private, region-blocked)
 * are simply absent from the response, which the caller uses to reject them.
 */
export async function getVideoDetails(videoIds) {
    const ids = [...new Set((videoIds || []).filter(Boolean))];
    const items = [];

    for (let i = 0; i < ids.length; i += YOUTUBE_MAX_IDS_PER_CALL) {
        const chunk = ids.slice(i, i + YOUTUBE_MAX_IDS_PER_CALL);
        const payload = await youtubeRequest("videos", {
            part: "snippet,contentDetails,status",
            id: chunk.join(","),
            maxResults: YOUTUBE_MAX_IDS_PER_CALL,
        });

        usage.videos += 1;
        usage.quotaUnits += QUOTA_COST.videos;

        items.push(...(payload.items || []));
    }

    return items;
}

/**
 * ISO 8601 duration -> seconds. "PT3M42S" -> 222.
 *
 * Handles the day component too: YouTube emits "P1DT2H" style values for very
 * long streams, and a hours/minutes/seconds-only regex would silently return a
 * wrong number rather than fail. Returns null when unparseable, so the filter can
 * reject "duration unavailable" instead of storing a fabricated 0.
 */
export function parseIso8601Duration(iso) {
    if (typeof iso !== "string") return null;
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso.trim());
    if (!match) return null;

    const [, days, hours, minutes, seconds] = match;

    const total =
        Number(days || 0) * 86400 +
        Number(hours || 0) * 3600 +
        Number(minutes || 0) * 60 +
        Number(seconds || 0);

    if (!Number.isFinite(total)) return null;

    /**
     * Zero means "no duration", not "a zero-second video".
     *
     * YouTube returns "P0D" for live broadcasts and for items whose duration it
     * cannot report. Testing the computed total rather than the presence of the
     * capture groups matters: "P0D" DOES capture a days group, and `!days` is false
     * for the string "0", so a presence check silently lets a fabricated 0 through
     * to the database. Returning null routes it to the "duration unavailable"
     * rejection instead.
     */
    return total > 0 ? Math.round(total) : null;
}

/**
 * Picks the largest available thumbnail URL.
 *
 * The URL is stored as-is and pointed at YouTube's CDN — thumbnails are never
 * downloaded or re-uploaded to Cloudinary. YouTube omits higher resolutions for
 * some videos, so the list is ordered by preference and falls through.
 */
export function pickThumbnail(thumbnails) {
    if (!thumbnails) return "";
    for (const size of ["maxres", "standard", "high", "medium", "default"]) {
        const url = thumbnails[size]?.url;
        if (url) return url;
    }
    return "";
}

/** The same ID shape the frontend player validates against. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const isValidYouTubeId = (id) => typeof id === "string" && YOUTUBE_ID_RE.test(id.trim());

/**
 * Normalises a videos.list item into the flat shape the filter and mapper use, so
 * neither has to know the API's nesting.
 */
export function normaliseVideoItem(item) {
    const snippet = item?.snippet || {};
    const status = item?.status || {};
    const contentDetails = item?.contentDetails || {};

    return {
        videoId: item?.id || null,
        title: snippet.title || "",
        description: snippet.description || "",
        channelId: snippet.channelId || "",
        channelTitle: snippet.channelTitle || "",
        publishedAt: snippet.publishedAt || null,
        thumbnail: pickThumbnail(snippet.thumbnails),
        tags: Array.isArray(snippet.tags) ? snippet.tags : [],
        liveBroadcastContent: snippet.liveBroadcastContent || "none",
        duration: parseIso8601Duration(contentDetails.duration),
        rawDuration: contentDetails.duration || null,
        privacyStatus: status.privacyStatus || null,
        embeddable: status.embeddable === true,
        uploadStatus: status.uploadStatus || null,
    };
}
