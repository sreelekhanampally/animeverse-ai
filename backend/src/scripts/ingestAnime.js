/**
 * AniList anime ingestion CLI.
 *
 *   npm run ingest:anime                    # full verified seed list (50 anime)
 *   npm run ingest:anime -- --limit=5       # first 5 of the seed list
 *   npm run ingest:anime -- --ids=21,20     # explicit AniList ids
 *   npm run ingest:anime -- --search="cowboy bebop" --limit=3
 *   npm run ingest:anime -- --trending --limit=25
 *   npm run ingest:anime -- --dry-run --limit=5
 *
 * A script rather than an HTTP endpoint, deliberately. The brief allows an
 * endpoint only behind admin protection, and this codebase has no role/admin
 * concept on the User model — so exposing ingestion over HTTP would either be
 * unprotected or require inventing an authorisation system that nothing else
 * uses. Ingestion is an operator task, and a script is the honest shape for it.
 *
 * Exits non-zero if anything failed, so CI or a cron wrapper can detect it.
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { POPULAR_ANIME_IDS } from "../seeds/popularAnime.js";
import {
    ingestAnimeByIds,
    ingestAnimeBySearch,
    ingestPopularSeed,
    ingestTrendingFromAniList,
} from "../utils/animeIngest.js";
import { fetchAnimeByIds, mapAniListMediaToAnime } from "../services/anilist.service.js";
import { Anime } from "../models/anime.model.js";

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

const line = (char = "-") => console.log(char.repeat(60));

function printReport(report, { label }) {
    line("=");
    console.log(`  ${label}`);
    line("=");
    console.log(`  Requested : ${report.requested}`);
    console.log(`  Imported  : ${report.imported}`);
    console.log(`  Updated   : ${report.updated}`);
    console.log(`  Failed    : ${report.failed}`);

    if (report.failures?.length) {
        console.log("\n  Failures:");
        for (const failure of report.failures) {
            console.log(`    - ${failure.anilistId}: ${failure.reason}`);
        }
    }
    if (report.note) console.log(`\n  Note: ${report.note}`);
    line("=");
}

/**
 * Progress is printed per anime so a long run is observable and a mid-list
 * failure is visible immediately rather than only in the final tally.
 */
const onProgress = (() => {
    let n = 0;
    return (event) => {
        n += 1;
        const index = String(n).padStart(3);
        if (event.status === "failed") {
            console.log(`  ${index}. FAILED   ${event.anilistId} — ${event.reason}`);
        } else {
            const action = event.action === "imported" ? "imported" : "updated ";
            console.log(`  ${index}. ${action} ${String(event.anilistId).padEnd(7)} ${event.title}`);
        }
    };
})();

/**
 * --dry-run fetches and maps but never writes, so the mapping can be inspected
 * against real API output before touching the database.
 */
async function dryRun(limit) {
    const ids = POPULAR_ANIME_IDS.slice(0, Number(limit) || 5);
    console.log(`Dry run — fetching ${ids.length} anime from AniList, writing nothing.\n`);
    const media = await fetchAnimeByIds(ids);

    for (const item of media) {
        const doc = mapAniListMediaToAnime(item);
        console.log(`  ${doc.anilistId}  ${doc.title.display}`);
        console.log(`     genres     : ${doc.genres.join(", ") || "(none)"}`);
        console.log(`     episodes   : ${doc.episodes ?? "null"}   duration: ${doc.duration ?? "null"} min`);
        console.log(`     season     : ${doc.season || "null"} ${doc.seasonYear || ""}   format: ${doc.format || "null"}`);
        console.log(`     studios    : ${doc.studios.join(", ") || "(none)"}`);
        console.log(`     status     : ${doc.status}   source: ${doc.source}   score: ${doc.averageScore}`);
        console.log(`     characters : ${doc.characters.length} (${doc.characters.slice(0, 3).map((c) => c.name).join(", ")}${doc.characters.length > 3 ? ", ..." : ""})`);
        console.log(`     cover      : ${doc.coverImage.large ? "yes" : "MISSING"}   banner: ${doc.bannerImage ? "yes" : "none"}`);
        console.log(`     description: ${doc.description.length} chars — "${doc.description.slice(0, 70).replace(/\n/g, " ")}..."`);
        console.log(`     HTML left? : ${/<[^>]+>/.test(doc.description) ? "YES (BUG)" : "no"}`);
        console.log("");
    }
    console.log(`Fetched ${media.length}/${ids.length}. Nothing written.`);
}

const run = async () => {
    const args = parseArgs(process.argv);
    const limit = args.limit ? Number(args.limit) : undefined;

    if (args["dry-run"]) {
        // No DB connection needed when nothing is written.
        await dryRun(limit);
        return 0;
    }

    await connectDB();

    // Guarantees the unique index on anilistId exists before the first write,
    // rather than relying on Mongoose's background index build having finished.
    await Anime.init();

    let report;
    if (args.ids) {
        const ids = String(args.ids).split(",").map((s) => Number(s.trim()));
        console.log(`Ingesting ${ids.length} AniList id(s)...\n`);
        report = await ingestAnimeByIds(ids, { onProgress });
        printReport(report, { label: "AniList ingestion — by id" });
    } else if (args.search) {
        console.log(`Searching AniList for "${args.search}"...\n`);
        report = await ingestAnimeBySearch(String(args.search), { limit: limit || 5, onProgress });
        printReport(report, { label: `AniList ingestion — search "${args.search}"` });
    } else if (args.trending) {
        console.log(`Ingesting top ${limit || 50} by AniList popularity...\n`);
        report = await ingestTrendingFromAniList({ limit: limit || 50, onProgress });
        printReport(report, { label: "AniList ingestion — popularity ranking" });
    } else {
        const count = limit || POPULAR_ANIME_IDS.length;
        console.log(`Ingesting ${count} anime from the verified seed list...\n`);
        report = await ingestPopularSeed({ limit, onProgress });
        printReport(report, { label: "AniList ingestion — popular seed" });
    }

    const total = await Anime.countDocuments();
    const distinct = (await Anime.distinct("anilistId")).length;
    console.log(`  Anime documents in DB : ${total}`);
    console.log(`  Distinct anilistIds   : ${distinct}`);
    console.log(`  Duplicates            : ${total - distinct}`);
    line("=");

    return report.failed > 0 ? 1 : 0;
};

let exitCode = 1;
try {
    exitCode = await run();
} catch (error) {
    console.error("\nIngestion aborted:", error.message);
    exitCode = 1;
} finally {
    // Always release the connection; a dangling socket would hang the process.
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
process.exit(exitCode);
