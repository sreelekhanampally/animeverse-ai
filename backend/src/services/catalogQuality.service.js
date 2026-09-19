import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";
import {
    getQuotaUsage,
    getVideoDetails,
    hasYouTubeApiKey,
    normaliseVideoItem,
    resetQuotaUsage,
} from "./youtube.service.js";
import { isSearchableEmbedding } from "./embedding.service.js";
import {
    MAX_VIDEOS_PER_ANIME,
    assessAnimeEntityRelevance,
    classifyVideoKind,
    evaluateVideo,
    titleFingerprint,
} from "../utils/youtubeIngest.js";

/**
 * Catalogue-quality audit.
 *
 * This service intentionally separates "how many rows exist" from "how many rows
 * are worth showing". The default audit is read-only and works entirely from
 * MongoDB. `live=true` adds a batched videos.list revalidation against YouTube,
 * without using search.list and without downloading any media.
 */

export const CATALOG_QUALITY_VERSION = "catalog-quality-v2-entity-links";
export const MIN_HEALTHY_VIDEOS_PER_ANIME = 3;

export const VIDEO_CONTENT_KINDS = [
    "trailer",
    "teaser",
    "opening",
    "ending",
    "clip",
    "promo",
    "music",
    "other",
];

const displayTitle = (anime) =>
    anime?.title?.display || anime?.title?.english || anime?.title?.romaji || anime?.title?.native || "Untitled anime";

export function animeMetadataCompleteness(anime) {
    const checks = {
        title: Boolean(displayTitle(anime) && displayTitle(anime) !== "Untitled anime"),
        description: Boolean(String(anime?.description || "").trim()),
        genres: Array.isArray(anime?.genres) && anime.genres.length > 0,
        cover: Boolean(anime?.coverImage?.extraLarge || anime?.coverImage?.large),
        studios: Array.isArray(anime?.studios) && anime.studios.length > 0,
        year: Number.isFinite(anime?.startYear),
    };

    const available = Object.values(checks).filter(Boolean).length;
    return {
        available,
        total: Object.keys(checks).length,
        percent: Math.round((available / Object.keys(checks).length) * 100),
        checks,
    };
}

export function structuralIssuesForVideo(video) {
    const issues = [];
    const id = String(video?.externalVideoId || "");

    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) issues.push("invalid YouTube id");
    if (!video?.anime?._id && !video?.anime) issues.push("missing anime link");
    if (!String(video?.title || "").trim()) issues.push("missing title");
    if (!String(video?.thumbnail || "").trim()) issues.push("missing thumbnail");
    if (!Number.isFinite(video?.duration) || video.duration <= 0) issues.push("invalid duration");
    if (!String(video?.description || "").trim()) issues.push("missing description");

    return issues;
}

export function detectDuplicateTitleGroups(videos) {
    const groups = new Map();

    for (const video of videos || []) {
        if ((video?.sourceType || "cloudinary") !== "youtube") continue;
        const animeId = String(video?.anime?._id || video?.anime || "none");
        const fingerprint = titleFingerprint(video?.title);
        if (!fingerprint) continue;
        const key = `${animeId}::${fingerprint}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(video);
    }

    return [...groups.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([key, rows]) => ({
            key,
            animeId: key.split("::")[0],
            fingerprint: key.split("::").slice(1).join("::"),
            count: rows.length,
            videos: rows.map((row) => ({
                id: String(row._id),
                youtubeId: row.externalVideoId,
                title: row.title,
                published: row.isPublished !== false,
                createdAt: row.createdAt || null,
            })),
        }))
        .sort((a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint));
}

export function buildCoverageSummary(animeDocs, videos, { minHealthy = MIN_HEALTHY_VIDEOS_PER_ANIME } = {}) {
    const counts = new Map();
    const kinds = new Map();

    for (const video of videos || []) {
        if (video?.isPublished === false || video?.sourceType !== "youtube") continue;
        const animeId = String(video?.anime?._id || video?.anime || "none");
        counts.set(animeId, (counts.get(animeId) || 0) + 1);
        if (!kinds.has(animeId)) kinds.set(animeId, new Map());
        const kind = classifyVideoKind(video.title);
        kinds.get(animeId).set(kind, (kinds.get(animeId).get(kind) || 0) + 1);
    }

    const rows = (animeDocs || []).map((anime) => {
        const animeId = String(anime._id);
        const count = counts.get(animeId) || 0;
        const kindEntries = [...(kinds.get(animeId) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
        const dominant = kindEntries[0] || [null, 0];
        const dominantShare = count ? dominant[1] / count : 0;
        return {
            animeId,
            title: displayTitle(anime),
            metadataSource: anime.metadataSource || "unknown",
            popularity: Number(anime.popularity) || 0,
            count,
            gap: Math.max(0, minHealthy - count),
            overCeiling: Math.max(0, count - MAX_VIDEOS_PER_ANIME),
            dominantKind: dominant[0],
            dominantKindCount: dominant[1],
            dominantShare: Number(dominantShare.toFixed(3)),
            kinds: Object.fromEntries(kindEntries),
        };
    });

    const zero = rows.filter((row) => row.count === 0);
    const undercovered = rows.filter((row) => row.count > 0 && row.count < minHealthy);
    const overCeiling = rows.filter((row) => row.overCeiling > 0);
    const concentrated = rows.filter(
        (row) => row.count >= 5 && row.dominantKind && row.dominantShare >= 0.8
    );

    return { rows, zero, undercovered, overCeiling, concentrated };
}

/**
 * High-confidence live failures that are safe to *quarantine* (unpublish), not
 * delete. Borderline relevance/score failures remain review-only to avoid turning
 * a heuristic into destructive moderation.
 */
export function isSafeToQuarantineReason(reason) {
    const value = String(reason || "").toLowerCase();
    const safePrefixes = [
        "unavailable",
        "malformed videoid",
        "not public",
        "not embeddable",
        "upload status",
        "duration unavailable",
        "live content",
        "blocked term",
        "fabricated/fan content",
        "reaction/recap/commentary",
        "fan edit/amv",
        "brand/game crossover promo",
        "redistribution/aggregator signal",
        "shorts/engagement bait",
        "video-game promo",
        "fan lyric/music reupload",
        "hollywood casting",
        "live-action adaptation",
        "too short",
        "too long for promo",
        "opening/ending reupload",
        "denylisted after review",
        // Only reviewed/high-confidence collisions are automatically reversible.
        // Generic entity mismatches stay manual-review only.
        "anime entity collision",
    ];
    return safePrefixes.some((prefix) => value.startsWith(prefix));
}

export function buildQualityFirstOrder(animeDocs, countsByAnime) {
    return [...(animeDocs || [])].sort((a, b) => {
        const aCount = countsByAnime.get(String(a._id)) || 0;
        const bCount = countsByAnime.get(String(b._id)) || 0;
        if (aCount !== bCount) return aCount - bCount;

        const popularityDiff = (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
        if (popularityDiff !== 0) return popularityDiff;

        return String(a._id).localeCompare(String(b._id));
    });
}

const embeddingFields =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingGeneratedAt +embeddingTextHash";

function metadataDrift(stored, fresh) {
    const drift = [];
    if (String(stored.title || "").trim() !== String(fresh.title || "").trim()) drift.push("title");
    if (Number(stored.duration || 0) !== Number(fresh.duration || 0)) drift.push("duration");
    if (String(stored.thumbnail || "") !== String(fresh.thumbnail || "")) drift.push("thumbnail");
    return drift;
}

export async function auditCatalogQuality({ live = false, limit = 0, quarantine = false } = {}) {
    if (quarantine && !live) {
        throw new Error("--quarantine requires --live so only current YouTube status can unpublish a video.");
    }
    if (live && !hasYouTubeApiKey()) {
        throw new Error("YOUTUBE_API_KEY is required for a live catalogue audit.");
    }

    const animeDocs = await Anime.find({})
        .select(embeddingFields)
        .sort({ popularity: -1, _id: 1 })
        .lean();

    let videoQuery = Video.find({ sourceType: "youtube" })
        .select(embeddingFields)
        .populate("anime", "title genres studios format metadataSource popularity")
        .sort({ _id: 1 });
    if (limit > 0) videoQuery = videoQuery.limit(limit);
    const videos = await videoQuery.lean();

    const published = videos.filter((video) => video.isPublished !== false);
    const structural = [];
    const staleEmbeddings = [];
    const kindCounts = new Map();
    const associationReview = [];
    const associationCollisions = [];

    for (const video of published) {
        const issues = structuralIssuesForVideo(video);
        if (issues.length) {
            structural.push({
                id: String(video._id),
                youtubeId: video.externalVideoId,
                title: video.title,
                issues,
            });
        }
        if (!isSearchableEmbedding(video)) {
            staleEmbeddings.push({
                id: String(video._id),
                youtubeId: video.externalVideoId,
                title: video.title,
            });
        }
        const kind = classifyVideoKind(video.title);
        kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);

        if (video.anime) {
            // Offline association audit deliberately has no channel identity, so a
            // legacy series-owned upload that omits the anime name can be flagged
            // for review but can never be auto-quarantined from this pass.
            const association = assessAnimeEntityRelevance(
                { title: video.title, description: video.description, channelTitle: "" },
                video.anime,
                { allowOwnChannel: false }
            );
            if (!association.ok) {
                const row = {
                    id: String(video._id),
                    youtubeId: video.externalVideoId,
                    title: video.title,
                    animeId: String(video.anime?._id || video.anime),
                    animeTitle: displayTitle(video.anime),
                    status: association.status,
                    reason: association.reason,
                    score: association.score || 0,
                    matchedAlias: association.matchedAlias || null,
                    matchedTokens: association.matchedTokens || [],
                    descriptionSupportsAnime: Boolean(association.descriptionSupportsAnime),
                };
                if (association.status === "collision") associationCollisions.push(row);
                else associationReview.push(row);
            }
        }
    }

    const duplicateGroups = detectDuplicateTitleGroups(published);
    const coverage = buildCoverageSummary(animeDocs, published);

    const metadataBySource = {};
    for (const anime of animeDocs) {
        const source = anime.metadataSource || "unknown";
        if (!metadataBySource[source]) {
            metadataBySource[source] = {
                count: 0,
                completenessTotal: 0,
                missingDescription: 0,
                missingGenres: 0,
                missingCover: 0,
            };
        }
        const completeness = animeMetadataCompleteness(anime);
        const bucket = metadataBySource[source];
        bucket.count += 1;
        bucket.completenessTotal += completeness.percent;
        if (!completeness.checks.description) bucket.missingDescription += 1;
        if (!completeness.checks.genres) bucket.missingGenres += 1;
        if (!completeness.checks.cover) bucket.missingCover += 1;
    }
    for (const bucket of Object.values(metadataBySource)) {
        bucket.averageCompleteness = bucket.count
            ? Math.round(bucket.completenessTotal / bucket.count)
            : 0;
        delete bucket.completenessTotal;
    }

    const report = {
        version: CATALOG_QUALITY_VERSION,
        generatedAt: new Date().toISOString(),
        mode: live ? "live" : "offline",
        scope: {
            anime: animeDocs.length,
            youtubeVideosScanned: videos.length,
            publishedYoutubeVideosScanned: published.length,
            limit: limit || null,
        },
        summary: {
            structuralIssueVideos: structural.length,
            staleOrMissingEmbeddings: staleEmbeddings.length,
            duplicateTitleGroups: duplicateGroups.length,
            animeWithNoPublishedYouTube: coverage.zero.length,
            animeUnderRecommendedCoverage: coverage.undercovered.length,
            animeOverCeiling: coverage.overCeiling.length,
            animeWithContentConcentration: coverage.concentrated.length,
            associationReviewCandidates: associationReview.length,
            associationCollisionCandidates: associationCollisions.length,
        },
        contentKinds: Object.fromEntries([...kindCounts.entries()].sort((a, b) => b[1] - a[1])),
        metadataBySource,
        structural,
        staleEmbeddings,
        duplicateGroups,
        coverage: {
            zero: coverage.zero,
            undercovered: coverage.undercovered,
            overCeiling: coverage.overCeiling,
            concentrated: coverage.concentrated,
        },
        associations: {
            review: associationReview,
            collisions: associationCollisions,
        },
        live: null,
    };

    if (!live) return report;

    resetQuotaUsage();
    const validIds = published
        .map((video) => video.externalVideoId)
        .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(String(id || "")));
    const freshItems = await getVideoDetails(validIds);
    const freshById = new Map(
        freshItems.map((item) => {
            const normalised = normaliseVideoItem(item);
            return [normalised.videoId, normalised];
        })
    );

    const approved = [];
    const review = [];
    const quarantineCandidates = [];
    const drifted = [];

    for (const stored of published) {
        const youtubeId = String(stored.externalVideoId || "");
        if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
            quarantineCandidates.push({
                id: String(stored._id),
                youtubeId,
                title: stored.title,
                reason: "malformed videoId",
            });
            continue;
        }

        const fresh = freshById.get(youtubeId);
        if (!fresh) {
            quarantineCandidates.push({
                id: String(stored._id),
                youtubeId,
                title: stored.title,
                reason: "unavailable (not returned by videos.list)",
            });
            continue;
        }

        const verdict = evaluateVideo(fresh, { anime: stored.anime || null });
        const drift = metadataDrift(stored, fresh);
        if (drift.length) {
            drifted.push({
                id: String(stored._id),
                youtubeId,
                title: stored.title,
                fields: drift,
                freshTitle: fresh.title,
            });
        }

        if (verdict.ok) {
            approved.push({
                id: String(stored._id),
                youtubeId,
                title: stored.title,
                score: verdict.score,
                trustedChannel: Boolean(verdict.trustedChannel),
                kind: classifyVideoKind(fresh.title),
            });
            continue;
        }

        const entry = {
            id: String(stored._id),
            youtubeId,
            title: stored.title,
            reason: verdict.reason,
            score: verdict.score ?? 0,
        };
        if (isSafeToQuarantineReason(verdict.reason)) quarantineCandidates.push(entry);
        else review.push(entry);
    }

    let quarantined = 0;
    if (quarantine && quarantineCandidates.length) {
        const ids = quarantineCandidates.map((entry) => entry.id);
        const result = await Video.updateMany(
            { _id: { $in: ids }, sourceType: "youtube", isPublished: true },
            { $set: { isPublished: false } }
        );
        quarantined = result.modifiedCount || 0;
    }

    report.live = {
        approved,
        review,
        quarantineCandidates,
        metadataDrift: drifted,
        quarantined,
        quota: getQuotaUsage(),
    };
    report.summary.liveApproved = approved.length;
    report.summary.liveNeedsReview = review.length;
    report.summary.liveQuarantineCandidates = quarantineCandidates.length;
    report.summary.liveMetadataDrift = drifted.length;
    report.summary.quarantined = quarantined;

    return report;
}


/**
 * Focused live association repair. Dry-run by default. `apply=true` unpublishes
 * only high-confidence entity collisions, never generic mismatches and never any
 * unrelated quality finding. This keeps the repair reversible and scoped.
 */
export async function auditCatalogAssociations({ apply = false, limit = 0 } = {}) {
    const full = await auditCatalogQuality({ live: true, limit, quarantine: false });
    const review = (full.live?.review || []).filter((row) =>
        String(row.reason || "").toLowerCase().startsWith("anime entity mismatch")
    );
    const collisions = (full.live?.quarantineCandidates || []).filter((row) =>
        String(row.reason || "").toLowerCase().startsWith("anime entity collision")
    );

    let unpublished = 0;
    if (apply && collisions.length) {
        const ids = collisions.map((row) => row.id);
        const result = await Video.updateMany(
            { _id: { $in: ids }, sourceType: "youtube", isPublished: true },
            { $set: { isPublished: false } }
        );
        unpublished = result.modifiedCount || 0;
    }

    return {
        version: "catalog-association-repair-v1",
        generatedAt: new Date().toISOString(),
        mode: apply ? "apply" : "dry-run",
        scanned: full.scope.publishedYoutubeVideosScanned,
        keep: (full.live?.approved || []).length,
        review,
        collisions,
        unpublished,
        quota: full.live?.quota || null,
    };
}
