import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import { Anime } from "../models/anime.model.js";
import { User } from "../models/user.model.js";
import {
    getVideoDetails,
    isValidYouTubeId,
    normaliseVideoItem,
    searchVideos,
    YouTubeQuotaError,
} from "../services/youtube.service.js";

/**
 * YouTube ingestion.
 *
 * Discovers real anime-related videos through the official Data API and creates
 * Video documents that carry only the 11-character YouTube ID. Nothing is
 * downloaded, no stream URL is stored, no media reaches Cloudinary — playback is
 * handled entirely by the existing Phase 1 YouTube embed.
 *
 * Split from the service (which only talks to Google) and the CLI (which only
 * parses argv and prints), so the same logic could later run from a job.
 */

/**
 * Query templates, applied per anime title.
 *
 * Deliberately biased toward official promotional material. The brief's excluded
 * patterns ("full episode", "watch full anime", "episode download", "free full
 * episodes") are absent by design — we never go looking for pirated uploads, and
 * the blocked-term filter is a second line of defence for when a search returns
 * one anyway.
 *
 * Order matters: the first templates are the highest-signal, and --per-anime
 * truncates from the end, so a conservative run still gets trailers first.
 */
export const QUERY_TEMPLATES = [
    (title) => `${title} official trailer`,
    (title) => `${title} opening`,
    (title) => `${title} official clip`,
    (title) => `${title} trailer`,
    (title) => `${title} ending`,
];

/**
 * Small, targeted blocked-term list — not an aggressive blacklist.
 *
 * Each entry targets piracy/full-episode uploads specifically. Kept short on
 * purpose: broad words like "episode" or "full" would reject legitimate material
 * ("Episode 1 Preview", "Full Trailer", "Full Opening"), which the brief warns
 * against.
 */
export const BLOCKED_TERMS = [
    "full episode",
    "full episodes",
    "watch full",
    "episode 1 full",
    "episode 2 full",
    "download anime",
    "free anime download",
    "eng sub full",
    "full movie",
];

/**
 * The system account that owns imported videos.
 *
 * Required, not optional: Channel pages resolve by `username`, the Dashboard and
 * `getAllVideos?userId=` filter by `owner`, and the owner `$lookup` + `$first`
 * in every video pipeline yields null without one — so ownerless videos would
 * render with no creator anywhere in the UI.
 *
 * Assigning them to a real user instead would be wrong: their Dashboard stats and
 * subscriber-facing channel would silently absorb content they never uploaded.
 * Authorization is untouched — this account owns the videos outright, so the
 * existing "is this your video?" checks keep working unchanged.
 */
export const INGESTION_OWNER = {
    username: "animeverse_official",
    email: "official@animeverse.local",
    fullName: "AnimeVerse Official",
    // Neutral placeholder; `avatar` is required by the User schema. Not a real
    // person's likeness and not fetched from anywhere.
    avatar: "https://ui-avatars.com/api/?name=AnimeVerse&background=6d28d9&color=fff&size=256",
};

/**
 * Idempotent: created once, then reused. The unique index on `username` makes the
 * upsert atomic, so two concurrent runs cannot both create it.
 *
 * The password is a throwaway random value that is never printed or stored
 * anywhere else — this account exists to own documents, not to be logged into.
 * It is deliberately NOT derived from an env secret, so nobody can guess it.
 */
export async function ensureIngestionOwner() {
    const existing = await User.findOne({ username: INGESTION_OWNER.username }).select("_id username");
    if (existing) return { user: existing, created: false };

    const user = await User.create({
        ...INGESTION_OWNER,
        password: `${new mongoose.Types.ObjectId().toString()}${Math.random().toString(36).slice(2)}${Date.now()}`,
    });

    return { user, created: true };
}

const containsBlockedTerm = (text) => {
    const haystack = String(text || "").toLowerCase();
    return BLOCKED_TERMS.find((term) => haystack.includes(term)) || null;
};

/**
 * The conservative filter. Returns { ok } or { ok: false, reason }.
 *
 * Only checks facts present in the videos.list payload — nothing is inferred.
 * `existingIds` covers both what is already in MongoDB and what this run has
 * already accepted, so a video found by two different queries is not imported
 * twice.
 */
export function evaluateVideo(video, { existingIds = new Set(), seenIds = new Set() } = {}) {
    if (!video?.videoId) return { ok: false, reason: "no videoId" };
    if (!isValidYouTubeId(video.videoId)) return { ok: false, reason: "malformed videoId" };

    // videos.list omits ids that are deleted/private/region-blocked, so an id that
    // survived discovery but has no title here is unavailable.
    if (!video.title) return { ok: false, reason: "unavailable (no metadata returned)" };

    if (video.privacyStatus !== "public") {
        return { ok: false, reason: `not public (${video.privacyStatus || "unknown"})` };
    }
    if (!video.embeddable) return { ok: false, reason: "not embeddable" };
    if (video.uploadStatus && video.uploadStatus !== "processed") {
        return { ok: false, reason: `upload status ${video.uploadStatus}` };
    }
    if (video.duration === null || video.duration === undefined) {
        return { ok: false, reason: "duration unavailable" };
    }
    // A live/upcoming stream has no stable duration and is not the promotional
    // content this ingestion is for.
    if (video.liveBroadcastContent && video.liveBroadcastContent !== "none") {
        return { ok: false, reason: `live content (${video.liveBroadcastContent})` };
    }

    const blocked = containsBlockedTerm(`${video.title} ${video.description.slice(0, 400)}`);
    if (blocked) return { ok: false, reason: `blocked term "${blocked}"` };

    if (existingIds.has(video.videoId)) return { ok: false, reason: "already exists in AnimeVerse" };
    if (seenIds.has(video.videoId)) return { ok: false, reason: "duplicate in this run" };

    return { ok: true };
}

/**
 * Conservative tags drawn from the Anime document — the anime's own title plus its
 * real AniList genres, lowercased. No invented keywords, and capped so a document
 * does not accumulate a dozen meaningless tags.
 */
export function buildTags(anime) {
    const tags = new Set();
    const display = anime?.title?.display || "";
    if (display) tags.add(display.toLowerCase());
    tags.add("anime");
    for (const genre of (anime?.genres || []).slice(0, 3)) {
        if (genre) tags.add(String(genre).toLowerCase());
    }
    return [...tags].slice(0, 6);
}

/**
 * YouTube metadata + Anime -> Video document.
 *
 * Only fields that exist on the Video schema are set. `videoFile` is left unset
 * entirely (not ""), because Phase 1 made it conditionally required — a YouTube
 * document legitimately has no file, and an empty string would be a fabricated
 * value. Descriptions are truncated because the schema requires a non-empty
 * description and YouTube descriptions can run to thousands of characters of
 * links and boilerplate.
 */
export function mapYouTubeVideoToDocument(video, { anime, ownerId }) {
    const description = (video.description || "").trim();

    return {
        sourceType: "youtube",
        externalVideoId: video.videoId,
        // videoFile intentionally omitted — see above.
        thumbnail: video.thumbnail,
        title: video.title.slice(0, 300),
        description: description ? description.slice(0, 5000) : video.title.slice(0, 300),
        duration: video.duration,
        views: 0,
        isPublished: true,
        owner: ownerId,
        anime: anime._id,
        tags: buildTags(anime),
        // Matches the schema's String category. Existing documents all use
        // "General"; "Anime" is the stronger, more accurate value for this content
        // and the field is free-form, so no convention is broken.
        category: "Anime",
    };
}

/** Every YouTube id already stored, so discovery can skip them before videos.list. */
export async function loadExistingYouTubeIds() {
    const docs = await Video.find({ sourceType: "youtube" })
        .select("externalVideoId")
        .lean();
    return new Set(docs.map((doc) => doc.externalVideoId).filter(Boolean));
}

/**
 * Resolves which anime to ingest for. Never calls AniList — Phase 2 owns that, and
 * this reads the existing collection only.
 */
export async function resolveTargetAnime({ animeName, animeId, limit } = {}) {
    if (animeId) {
        if (!mongoose.isValidObjectId(animeId)) {
            throw new Error(`"${animeId}" is not a valid Mongo ObjectId`);
        }
        const anime = await Anime.findById(animeId);
        return anime ? [anime] : [];
    }

    if (animeName) {
        // Anchored, case-insensitive match on any of the stored titles. Escaped so a
        // title containing regex metacharacters cannot alter the query.
        const escaped = String(animeName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "i");
        const found = await Anime.find({
            $or: [
                { "title.display": pattern },
                { "title.english": pattern },
                { "title.romaji": pattern },
            ],
        }).limit(5);
        return found;
    }

    // Default: most popular first, so a conservative run covers recognisable series.
    return Anime.find().sort({ popularity: -1 }).limit(Number(limit) || 10);
}

/**
 * The ingestion run.
 *
 * Flow per anime: build queries -> search (discovery) -> dedupe ids -> ONE batched
 * videos.list for authoritative metadata -> filter -> insert. Deduplicating before
 * videos.list matters because the same trailer is routinely returned by several
 * queries, and it keeps the batch small.
 *
 * A quota error aborts the whole run (retrying cannot help); any other per-video
 * error is recorded and the run continues.
 */
export async function ingestYouTubeForAnime({
    animeList,
    perAnime = 3,
    queriesPerAnime = 2,
    dryRun = false,
    ownerId = null,
    onEvent = () => {},
}) {
    const report = {
        animeProcessed: 0,
        searches: 0,
        discovered: 0,
        uniqueDiscovered: 0,
        accepted: 0,
        rejected: 0,
        imported: 0,
        alreadyExists: 0,
        failed: 0,
        failures: [],
        rejections: [],
        items: [],
        quotaExhausted: false,
    };

    const existingIds = await loadExistingYouTubeIds();
    const seenIds = new Set();

    for (const anime of animeList) {
        const title = anime?.title?.display;
        if (!title) {
            report.failed += 1;
            report.failures.push({ anime: String(anime?._id), reason: "Anime document has no display title" });
            continue;
        }

        report.animeProcessed += 1;
        onEvent({ type: "anime", title, animeId: anime._id });

        const queries = QUERY_TEMPLATES.slice(0, queriesPerAnime).map((build) => build(title));
        const candidateIds = new Set();

        for (const query of queries) {
            onEvent({ type: "query", title, query });
            try {
                // Slight over-fetch relative to perAnime, since filtering will
                // discard some results; still bounded to keep quota predictable.
                const results = await searchVideos(query, { maxResults: Math.min(perAnime * 2 + 2, 15) });
                report.searches += 1;
                report.discovered += results.length;

                for (const result of results) {
                    if (!existingIds.has(result.videoId) && !seenIds.has(result.videoId)) {
                        candidateIds.add(result.videoId);
                    } else if (existingIds.has(result.videoId)) {
                        report.alreadyExists += 1;
                    }
                }
            } catch (error) {
                if (error instanceof YouTubeQuotaError) {
                    report.quotaExhausted = true;
                    onEvent({ type: "quota", message: error.message });
                    return report;
                }
                report.failed += 1;
                report.failures.push({ anime: title, query, reason: error.message });
                onEvent({ type: "failed", title, query, reason: error.message });
            }
        }

        if (!candidateIds.size) continue;
        report.uniqueDiscovered += candidateIds.size;

        // One batched call for authoritative metadata (1 quota unit for up to 50).
        let details;
        try {
            const items = await getVideoDetails([...candidateIds]);
            details = items.map(normaliseVideoItem);
        } catch (error) {
            if (error instanceof YouTubeQuotaError) {
                report.quotaExhausted = true;
                onEvent({ type: "quota", message: error.message });
                return report;
            }
            report.failed += 1;
            report.failures.push({ anime: title, reason: `videos.list failed: ${error.message}` });
            onEvent({ type: "failed", title, reason: error.message });
            continue;
        }

        // Ids that vanished between search and videos.list are unavailable.
        const returned = new Set(details.map((d) => d.videoId));
        for (const id of candidateIds) {
            if (!returned.has(id)) {
                report.rejected += 1;
                report.rejections.push({ videoId: id, reason: "unavailable (not returned by videos.list)" });
                onEvent({ type: "filtered", videoId: id, reason: "unavailable" });
            }
        }

        let acceptedForThisAnime = 0;

        for (const video of details) {
            if (acceptedForThisAnime >= perAnime) break;

            const verdict = evaluateVideo(video, { existingIds, seenIds });
            if (!verdict.ok) {
                report.rejected += 1;
                report.rejections.push({ videoId: video.videoId, title: video.title, reason: verdict.reason });
                onEvent({ type: "filtered", videoId: video.videoId, title: video.title, reason: verdict.reason });
                continue;
            }

            report.accepted += 1;
            acceptedForThisAnime += 1;
            seenIds.add(video.videoId);

            const summary = {
                videoId: video.videoId,
                title: video.title,
                channelTitle: video.channelTitle,
                duration: video.duration,
                embeddable: video.embeddable,
                anime: title,
                animeId: anime._id,
            };

            if (dryRun) {
                report.items.push({ ...summary, action: "would import" });
                onEvent({ type: "would-import", ...summary });
                continue;
            }

            try {
                const doc = mapYouTubeVideoToDocument(video, { anime, ownerId });
                const created = await Video.create(doc);
                report.imported += 1;
                report.items.push({ ...summary, action: "imported", _id: created._id });
                onEvent({ type: "imported", ...summary, _id: created._id });
            } catch (error) {
                // E11000 means the partial unique index caught a concurrent/duplicate
                // insert — not a failure, just an already-existing video.
                if (error?.code === 11000) {
                    report.accepted -= 1;
                    report.alreadyExists += 1;
                    onEvent({ type: "exists", ...summary });
                } else {
                    report.failed += 1;
                    report.failures.push({ anime: title, videoId: video.videoId, reason: error.message });
                    onEvent({ type: "failed", ...summary, reason: error.message });
                }
            }
        }
    }

    return report;
}
