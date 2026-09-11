/**
 * Jikan/MyAnimeList metadata fallback ingestion.
 *
 * This is an internal operator CLI, not a public HTTP route. It exists so an
 * AniList outage cannot freeze catalogue growth. Jikan is intentionally used
 * only for a small popularity-ranked metadata slice; YouTube ingestion and AI
 * embeddings continue to use the same Anime/Video collections afterward.
 *
 * Examples:
 *   npm run ingest:jikan -- --popular --limit=160
 *   npm run ingest:jikan -- --popular --limit=100 --dry-run
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Anime } from "../models/anime.model.js";
import { fetchPopularAnimeFromJikan, mapJikanAnimeToAnime } from "../services/jikan.service.js";
import { ingestPopularFromJikan } from "../utils/animeIngest.js";

const parseArgs = (argv) => {
    const args = {};
    for (const raw of argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
        if (match) args[match[1]] = match[2] === undefined ? true : match[2];
    }
    return args;
};

const line = (char = "=") => console.log(char.repeat(68));

function onProgress(event) {
    if (event.status === "failed") {
        console.log(`  ✖ MAL ${event.malId ?? "?"}: ${event.reason}`);
        return;
    }

    const marker = event.action === "imported" ? "+" : event.action === "updated" ? "↻" : "=";
    const note = event.reason ? ` (${event.reason})` : "";
    console.log(`  ${marker} ${String(event.malId ?? "?").padEnd(7)} ${event.title}${note}`);
}

function printReport(report) {
    line();
    console.log("Jikan metadata fallback — summary");
    line();
    console.log(`  Fetched             : ${report.requested}`);
    console.log(`  Imported new        : ${report.imported}`);
    console.log(`  Updated Jikan docs  : ${report.updated}`);
    console.log(`  Preserved AniList   : ${report.skipped}`);
    console.log(`  Failed              : ${report.failed}`);

    if (report.failures.length) {
        console.log("\n  Failures:");
        for (const failure of report.failures.slice(0, 20)) {
            console.log(`    - MAL ${failure.malId ?? "?"}: ${failure.reason}`);
        }
    }
    line();
}

async function dryRun(limit) {
    const media = await fetchPopularAnimeFromJikan({ limit });
    console.log(`Jikan dry run: fetched ${media.length} popular SFW anime. Nothing will be written.\n`);
    for (const item of media.slice(0, 25)) {
        const mapped = mapJikanAnimeToAnime(item);
        console.log(`  ${mapped.malId}  ${mapped.title.display}`);
    }
    if (media.length > 25) console.log(`  ... and ${media.length - 25} more`);
}

async function run() {
    const args = parseArgs(process.argv);
    const limit = Math.max(1, Math.min(Number(args.limit) || 160, 500));

    if (args["dry-run"]) {
        await dryRun(limit);
        return 0;
    }

    await connectDB();
    await Anime.init();

    console.log(`Ingesting top ${limit} by MyAnimeList popularity through Jikan...\n`);
    const report = await ingestPopularFromJikan({ limit, onProgress });
    printReport(report);

    const [total, anilistBacked, jikanBacked] = await Promise.all([
        Anime.countDocuments(),
        Anime.countDocuments({ metadataSource: "anilist" }),
        Anime.countDocuments({ metadataSource: "jikan" }),
    ]);
    console.log(`  Anime documents in DB : ${total}`);
    console.log(`  AniList-backed        : ${anilistBacked}`);
    console.log(`  Jikan fallback        : ${jikanBacked}`);
    line();

    const successful = report.imported + report.updated + report.skipped;
    return report.requested > 0 && successful === 0 ? 1 : 0;
}

let exitCode = 1;
try {
    exitCode = await run();
} catch (error) {
    console.error("\nJikan ingestion aborted:", error.message);
    exitCode = 1;
} finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
process.exit(exitCode);
