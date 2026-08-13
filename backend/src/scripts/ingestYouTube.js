/**
 * YouTube ingestion CLI.
 *
 *   npm run ingest:youtube -- --dry-run --anime="Naruto"
 *   npm run ingest:youtube -- --anime="Naruto" --per-anime=3
 *   npm run ingest:youtube -- --anime-id=68f0... --per-anime=2
 *   npm run ingest:youtube -- --limit=10 --per-anime=3
 *   npm run ingest:youtube -- --limit=15 --per-anime=3 --queries=2
 *   npm run ingest:youtube -- --limit=20 --per-anime=3 --total-cap
 *
 * --per-anime is a PER-RUN allowance by default (existing behaviour), additionally
 * clamped so no anime can exceed MAX_VIDEOS_PER_ANIME in total. With --total-cap it
 * becomes the desired TOTAL per anime and the run imports only the shortfall, so
 * re-running is effectively idempotent and spends no quota on anime already full.
 *
 * Internal operator tool, not an HTTP endpoint — the brief forbids a public
 * ingestion API, and this codebase has no admin/role concept to protect one with.
 *
 * Defaults are deliberately small (10 anime x 3 videos) so an accidental bare run
 * cannot import hundreds of videos or burn a day of API quota.
 *
 * Exits non-zero if anything failed, so a wrapper can detect it.
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";
import {
    getQuotaUsage,
    hasYouTubeApiKey,
    QUOTA_COST,
    resetQuotaUsage,
    YouTubeConfigError,
    YouTubeQuotaError,
} from "../services/youtube.service.js";
import {
    BLOCKED_TERMS,
    ensureIngestionOwner,
    ingestYouTubeForAnime,
    MAX_VIDEOS_PER_ANIME,
    QUERY_TEMPLATES,
    resolveTargetAnime,
} from "../utils/youtubeIngest.js";

const parseArgs = (argv) => {
    const args = { _: [] };
    for (const raw of argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
        if (!match) {
            args._.push(raw);
            continue;
        }
        const [, key, value] = match;
        args[key] = value === undefined ? true : value;
    }
    return args;
};

const line = (char = "-") => console.log(char.repeat(68));
const fmtDuration = (seconds) => {
    if (seconds === null || seconds === undefined) return "??:??";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Per-event logging with the marker set the brief asks for. Only the fields an
 * operator needs are printed — never a raw API payload.
 */
const makeLogger = ({ dryRun }) => (event) => {
    switch (event.type) {
        case "anime":
            console.log(
                `\n▸ ${event.title}` +
                    (event.existingCount !== undefined
                        ? `  (has ${event.existingCount}, room for ${event.slots})`
                        : "")
            );
            break;
        case "skipped":
            console.log(`\n▸ ${event.title}\n    — skipped: ${event.reason} (no quota spent)`);
            break;
        case "query":
            console.log(`    search: "${event.query}"`);
            break;
        case "would-import":
            console.log(
                `    ✓ would import  ${event.videoId}  [${fmtDuration(event.duration)}]  ${event.title}`
            );
            console.log(`                     channel: ${event.channelTitle}`);
            break;
        case "imported":
            console.log(`    ✓ imported     ${event.videoId}  [${fmtDuration(event.duration)}]  ${event.title}`);
            break;
        case "exists":
            console.log(`    ↻ already exists ${event.videoId}  ${event.title}`);
            break;
        case "filtered":
            console.log(`    ⊘ filtered     ${event.videoId}  ${event.reason}${event.title ? `  — ${event.title.slice(0, 60)}` : ""}`);
            break;
        case "failed":
            console.log(
                `    ✗ failed       ${[event.videoId, event.query && `query "${event.query}"`]
                    .filter(Boolean)
                    .join("  ")}  ${event.reason}`
            );
            break;
        case "quota":
            console.log(`\n${event.message}`);
            break;
        default:
            break;
    }
    void dryRun;
};

function printSummary(report, { dryRun }) {
    const usage = getQuotaUsage();

    line("=");
    console.log(`  ${dryRun ? "DRY RUN" : "YouTube ingestion"} — summary`);
    line("=");
    console.log(`  Anime processed      : ${report.animeProcessed}`);
    if (report.skippedFull) console.log(`  Anime skipped (full) : ${report.skippedFull}`);
    console.log(`  Searches performed   : ${report.searches}`);
    console.log(`  Videos discovered    : ${report.discovered} (${report.uniqueDiscovered} unique, after dedupe)`);
    console.log(`  Passed filters       : ${report.accepted}`);
    console.log(`  Filtered out         : ${report.rejected}`);
    console.log(`  ${dryRun ? "Would import       " : "Imported           "}  : ${dryRun ? report.items.length : report.imported}`);
    console.log(`  Already existed      : ${report.alreadyExists}`);
    console.log(`  Failed               : ${report.failed}`);

    if (report.failures.length) {
        console.log("\n  Failures:");
        for (const failure of report.failures.slice(0, 20)) {
            console.log(
                `    - ${[failure.anime, failure.query && `query "${failure.query}"`, failure.videoId]
                    .filter(Boolean)
                    .join(" / ")}: ${failure.reason}`
            );
        }
    }

    // Rejection reasons are aggregated rather than listed one by one: the per-video
    // lines above already show each one, and a tally is what tells you whether the
    // filter is behaving or quietly rejecting everything.
    if (report.rejections.length) {
        const counts = new Map();
        for (const rejection of report.rejections) {
            // Group by reason kind, not the interpolated detail.
            const key = rejection.reason.replace(/"[^"]*"/, '"..."').replace(/\(.*\)/, "(...)");
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        console.log("\n  Filter reasons:");
        for (const [reason, count] of [...counts].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(count).padStart(3)} x ${reason}`);
        }
    }

    console.log(
        `\n  API quota spent      : ~${usage.quotaUnits} units ` +
            `(${usage.search} search x ${QUOTA_COST.search} + ${usage.videos} videos.list x ${QUOTA_COST.videos})`
    );
    if (report.quotaExhausted) console.log("  Run stopped early: quota exhausted.");
    if (dryRun) console.log("\n  Nothing was written to MongoDB.");
    line("=");
}

const run = async () => {
    const args = parseArgs(process.argv);
    const dryRun = Boolean(args["dry-run"]);
    /**
     * Opt-in, so every documented command keeps its existing meaning.
     *   default        : --per-anime is this run's allowance (unchanged), additionally
     *                    clamped by the MAX_VIDEOS_PER_ANIME ceiling.
     *   --total-cap    : --per-anime is the desired TOTAL per anime; the run imports
     *                    only the deficit and skips anime already at the target.
     */
    const totalCap = Boolean(args["total-cap"]);
    const perAnime = Math.max(1, Math.min(Number(args["per-anime"]) || 3, 10));
    const queriesPerAnime = Math.max(1, Math.min(Number(args.queries) || 2, QUERY_TEMPLATES.length));
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));

    // Fail before connecting to anything if the key is absent — the exact message
    // the brief requires.
    if (!hasYouTubeApiKey()) {
        console.error("YouTube API key is required for YouTube ingestion.");
        return 1;
    }

    // The Anime collection is the search source, so a DB connection is needed even
    // for a dry run. Reads only in that mode — no create/update call is reached.
    await connectDB();

    const animeCount = await Anime.countDocuments();
    if (animeCount === 0) {
        console.error("Anime metadata not found. Run AniList ingestion first (npm run ingest:anime).");
        return 1;
    }

    const animeList = await resolveTargetAnime({
        animeName: args.anime && args.anime !== true ? String(args.anime) : undefined,
        animeId: args["anime-id"] && args["anime-id"] !== true ? String(args["anime-id"]) : undefined,
        limit,
    });

    if (!animeList.length) {
        console.error(
            "Anime metadata not found. Run AniList ingestion first (npm run ingest:anime)." +
                (args.anime || args["anime-id"] ? " No Anime document matched the given filter." : "")
        );
        return 1;
    }

    resetQuotaUsage();

    console.log(
        `${dryRun ? "DRY RUN — " : ""}YouTube ingestion: ${animeList.length} anime x ` +
            (totalCap
                ? `up to ${perAnime} TOTAL video(s) each (top-up mode)`
                : `up to ${perAnime} new video(s) each (ceiling ${MAX_VIDEOS_PER_ANIME} total)`) +
            `, ${queriesPerAnime} query template(s) each.`
    );
    console.log(`Estimated worst-case quota: ~${animeList.length * (queriesPerAnime * QUOTA_COST.search + QUOTA_COST.videos)} units.`);
    console.log(`Blocked terms: ${BLOCKED_TERMS.length} (${BLOCKED_TERMS.slice(0, 4).join(", ")}, ...)`);

    let ownerId = null;
    if (!dryRun) {
        // Only touched on a real run: a dry run must not write a User either.
        const { user, created } = await ensureIngestionOwner();
        ownerId = user._id;
        console.log(`Owner: ${user.username} (${created ? "created" : "existing"}) ${user._id}`);
        // Guarantees the partial unique index exists before the first insert, so
        // duplicates are caught by the database and not just by the in-run Set.
        await Video.init();
    }

    const report = await ingestYouTubeForAnime({
        animeList,
        perAnime,
        queriesPerAnime,
        dryRun,
        ownerId,
        totalCap,
        onEvent: makeLogger({ dryRun }),
    });

    console.log("");
    printSummary(report, { dryRun });

    const totalYouTube = await Video.countDocuments({ sourceType: "youtube" });
    const totalCloudinary = await Video.countDocuments({ sourceType: { $ne: "youtube" } });
    console.log(`  YouTube videos in DB   : ${totalYouTube}`);
    console.log(`  Cloudinary videos in DB: ${totalCloudinary}`);
    line("=");

    return report.failed > 0 || report.quotaExhausted ? 1 : 0;
};

let exitCode = 1;
try {
    exitCode = await run();
} catch (error) {
    if (error instanceof YouTubeQuotaError || error instanceof YouTubeConfigError) {
        console.error(`\n${error.message}`);
    } else {
        console.error("\nIngestion aborted:", error.message);
    }
    exitCode = 1;
} finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
process.exit(exitCode);
