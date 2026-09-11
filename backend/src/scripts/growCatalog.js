/**
 * Safe catalogue-growth orchestrator.
 *
 * Purpose: grow AnimeVerse from a small demo catalogue toward 1,000+ published
 * videos without weakening the existing YouTube quality/safety rules.
 *
 * One run intentionally stays below a typical 10k/day YouTube Data API quota:
 * 40 anime x 2 search queries ~= 8,000 search quota units (+ cheap videos.list).
 * Re-run on later quota windows with --offset=40,80,120. If an anime still has
 * room after the first two query templates, use --query-offset=2 or 4.
 *
 * Examples:
 *   npm run grow:catalog
 *   npm run grow:catalog -- --offset=40
 *   npm run grow:catalog -- --offset=80 --query-offset=2
 *   npm run grow:catalog -- --dry-run --offset=0
 */

import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(HERE, "../..");

const parseArgs = (argv) => {
    const args = {};
    for (const raw of argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
        if (match) args[match[1]] = match[2] === undefined ? true : match[2];
    }
    return args;
};

const clamp = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : fallback;
};

function runNodeScript(scriptName, args = [], { tolerateFailure = false } = {}) {
    console.log(`\n▶ ${scriptName} ${args.join(" ")}`);
    const result = spawnSync(process.execPath, [path.join(HERE, scriptName), ...args], {
        cwd: BACKEND_ROOT,
        stdio: "inherit",
        env: process.env,
    });

    const status = result.status ?? 1;
    if (status !== 0 && !tolerateFailure) {
        throw new Error(`${scriptName} exited with code ${status}`);
    }
    return status;
}

async function printStats(targetVideos) {
    await connectDB();
    try {
        const [anime, published, youtube, cloudinary, embeddedVideos, embeddedAnime] = await Promise.all([
            Anime.countDocuments(),
            Video.countDocuments({ isPublished: true }),
            Video.countDocuments({ isPublished: true, sourceType: "youtube" }),
            Video.countDocuments({ isPublished: true, sourceType: { $ne: "youtube" } }),
            Video.countDocuments({
                embeddingDimensions: 384,
                embeddingVersion: "metadata-v2",
            }),
            Anime.countDocuments({
                embeddingDimensions: 384,
                embeddingVersion: "metadata-v2",
            }),
        ]);

        console.log("\n============================================================");
        console.log("AnimeVerse catalogue status");
        console.log("============================================================");
        console.log(`Anime documents       : ${anime}`);
        console.log(`Published videos      : ${published}`);
        console.log(`  YouTube             : ${youtube}`);
        console.log(`  Cloudinary/legacy   : ${cloudinary}`);
        console.log(`Embedded videos       : ${embeddedVideos}/${published}`);
        console.log(`Embedded anime        : ${embeddedAnime}/${anime}`);
        console.log(`1k target             : ${published >= targetVideos ? "REACHED ✓" : `${targetVideos - published} remaining`}`);
        console.log("============================================================");
        return { anime, published, youtube, cloudinary, embeddedVideos, embeddedAnime };
    } finally {
        await mongoose.disconnect();
    }
}

async function main() {
    const args = parseArgs(process.argv);
    const animeTarget = clamp(args["anime-target"], 160, 50, 300);
    const targetVideos = clamp(args["video-target"], 1000, 100, 5000);
    const batch = clamp(args.batch, 40, 1, 45);
    const offset = clamp(args.offset, 0, 0, 5000);
    const queries = clamp(args.queries, 2, 1, 2);
    const queryOffset = clamp(args["query-offset"], 0, 0, 4);
    const perAnime = clamp(args["per-anime"], 15, 1, 15);
    const dryRun = Boolean(args["dry-run"]);

    console.log("AnimeVerse safe catalogue growth");
    console.log(`Anime metadata target : top ${animeTarget} by AniList popularity`);
    console.log(`YouTube batch         : offset ${offset}, ${batch} anime`);
    console.log(`Target per anime      : ${perAnime}`);
    console.log(`Search templates      : ${queries}, starting at ${queryOffset + 1}`);
    console.log(`Published-video goal  : ${targetVideos}+`);
    if (dryRun) console.log("Mode                  : DRY RUN for YouTube writes");

    // AniList upserts by anilistId, so repeating this is safe and keeps metadata
    // fresh while also bringing films/series beyond the original 50-item seed in.
    if (!dryRun) {
        runNodeScript("ingestAnime.js", ["--trending", `--limit=${animeTarget}`]);
    } else {
        console.log("\nDry run: skipping bulk AniList writes. Existing Anime documents will be used.");
    }

    const ytArgs = [
        `--offset=${offset}`,
        `--limit=${batch}`,
        `--per-anime=${perAnime}`,
        `--queries=${queries}`,
        `--query-offset=${queryOffset}`,
        "--total-cap",
    ];
    if (dryRun) ytArgs.push("--dry-run");

    // Quota exhaustion produces a non-zero exit by design. We still run the
    // embedding backfill afterward because videos imported before exhaustion are
    // valid and should become searchable immediately.
    const ytStatus = runNodeScript("ingestYouTube.js", ytArgs, { tolerateFailure: true });
    if (ytStatus !== 0) {
        console.warn("\nYouTube step ended early or reported a failure. This is commonly quota exhaustion; existing imports are preserved.");
    }

    if (!dryRun) {
        runNodeScript("backfillEmbeddings.js", ["--target=all"]);
        const stats = await printStats(targetVideos);
        if (stats.published < targetVideos) {
            console.log("\nNext safe growth pass:");
            console.log(`  npm run grow:catalog -- --offset=${offset + batch}`);
            console.log("If that popularity batch is exhausted, revisit it with --query-offset=2 to use different official-content searches.");
        }
    } else {
        console.log("\nDry run complete. Nothing was written by the YouTube step and embeddings were not changed.");
    }
}

main().catch(async (error) => {
    console.error(`\nCatalogue growth failed: ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
});
