/**
 * Safe catalogue-growth orchestrator.
 *
 * Metadata strategy by default:
 *   AniList -> Jikan/MyAnimeList -> existing MongoDB metadata
 *
 * This keeps catalogue growth moving during AniList outages without weakening
 * YouTube quality filters or inventing metadata. Jikan is only a fallback source;
 * when AniList later returns, matching MAL ids are promoted back to real AniList
 * ids by animeIngest.js instead of creating duplicate Anime documents.
 *
 * Examples:
 *   npm run grow:catalog -- --offset=0
 *   npm run grow:catalog -- --offset=40
 *   npm run grow:catalog -- --offset=0 --query-offset=2
 *   npm run grow:catalog -- --metadata-provider=jikan --offset=0
 *   npm run grow:catalog -- --metadata-provider=stored --offset=0
 *   npm run grow:catalog -- --dry-run --offset=0
 *
 * Backward compatibility:
 *   --skip-anilist behaves like --metadata-provider=stored.
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
const METADATA_PROVIDERS = new Set(["auto", "anilist", "jikan", "stored"]);

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

function runNodeScript(scriptName, args = []) {
    console.log(`\n▶ ${scriptName} ${args.join(" ")}`);

    const result = spawnSync(process.execPath, [path.join(HERE, scriptName), ...args], {
        cwd: BACKEND_ROOT,
        stdio: "inherit",
        env: process.env,
    });

    if (result.error) {
        console.error(`\n${scriptName} could not start: ${result.error.message}`);
        return { ok: false, status: null, error: result.error };
    }

    const status = Number.isInteger(result.status) ? result.status : 1;
    return {
        ok: status === 0,
        status,
        signal: result.signal ?? null,
        error: null,
    };
}

async function getAnimeInventory() {
    await connectDB();
    try {
        const [total, anilist, jikan] = await Promise.all([
            Anime.countDocuments(),
            Anime.countDocuments({ metadataSource: "anilist" }),
            Anime.countDocuments({ metadataSource: "jikan" }),
        ]);
        return { total, anilist, jikan };
    } finally {
        await mongoose.disconnect();
    }
}

async function printStats(targetVideos) {
    await connectDB();
    try {
        const [
            anime,
            anilistAnime,
            jikanAnime,
            published,
            youtube,
            cloudinary,
            embeddedVideos,
            embeddedAnime,
        ] = await Promise.all([
            Anime.countDocuments(),
            Anime.countDocuments({ metadataSource: "anilist" }),
            Anime.countDocuments({ metadataSource: "jikan" }),
            Video.countDocuments({ isPublished: true }),
            Video.countDocuments({ isPublished: true, sourceType: "youtube" }),
            Video.countDocuments({ isPublished: true, sourceType: { $ne: "youtube" } }),
            Video.countDocuments({
                isPublished: true,
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
        console.log(`  AniList-backed      : ${anilistAnime}`);
        console.log(`  Jikan fallback      : ${jikanAnime}`);
        console.log(`Published videos      : ${published}`);
        console.log(`  YouTube             : ${youtube}`);
        console.log(`  Cloudinary/legacy   : ${cloudinary}`);
        console.log(`Embedded videos       : ${embeddedVideos}/${published}`);
        console.log(`Embedded anime        : ${embeddedAnime}/${anime}`);
        console.log(
            `1k target             : ${
                published >= targetVideos ? "REACHED ✓" : `${targetVideos - published} remaining`
            }`
        );
        console.log("============================================================");

        return {
            anime,
            anilistAnime,
            jikanAnime,
            published,
            youtube,
            cloudinary,
            embeddedVideos,
            embeddedAnime,
        };
    } finally {
        await mongoose.disconnect();
    }
}

function normaliseMetadataProvider(args) {
    const requested = args["skip-anilist"]
        ? "stored"
        : String(args["metadata-provider"] || "auto").trim().toLowerCase();
    if (!METADATA_PROVIDERS.has(requested)) {
        throw new Error(
            `Unknown metadata provider "${requested}". Use auto, anilist, jikan, or stored.`
        );
    }
    return requested;
}

async function refreshMetadata({ provider, animeTarget, dryRun }) {
    if (dryRun) {
        console.log("\nDry run: metadata writes skipped; stored Anime documents will be used.");
        return { providerUsed: "stored", youtubeMetadataSource: null };
    }

    if (provider === "stored") {
        console.log("\nMetadata refresh       : skipped by operator; stored Anime will be used.");
        return { providerUsed: "stored", youtubeMetadataSource: null };
    }

    if (provider === "anilist" || provider === "auto") {
        const aniListResult = runNodeScript("ingestAnime.js", [
            "--trending",
            `--limit=${animeTarget}`,
        ]);

        if (aniListResult.ok) {
            console.log("\n✓ AniList metadata refresh completed.");
            return { providerUsed: "anilist", youtubeMetadataSource: null };
        }

        console.warn("\n⚠ AniList metadata refresh failed.");
        console.warn(`  ingestAnime.js exited with ${aniListResult.status ?? "no status"}.`);

        if (provider === "anilist") {
            throw new Error("AniList was explicitly requested and its metadata refresh failed.");
        }

        console.warn("  Trying Jikan/MyAnimeList fallback instead...");
    }

    if (provider === "jikan" || provider === "auto") {
        const jikanResult = runNodeScript("ingestJikan.js", [
            "--popular",
            `--limit=${animeTarget}`,
        ]);

        if (jikanResult.ok) {
            console.log("\n✓ Jikan metadata fallback completed.");
            // Existing AniList rows are deliberately preserved by the Jikan importer.
            // Targeting only Jikan-backed rows makes the next YouTube batch useful
            // instead of filling its 40 slots with already-full older Anime records.
            return { providerUsed: "jikan", youtubeMetadataSource: "jikan" };
        }

        console.warn("\n⚠ Jikan metadata fallback also failed.");
        console.warn(`  ingestJikan.js exited with ${jikanResult.status ?? "no status"}.`);

        if (provider === "jikan") {
            throw new Error("Jikan was explicitly requested and its metadata refresh failed.");
        }

        console.warn("  Falling back to Anime documents already stored in MongoDB.");
    }

    return { providerUsed: "stored", youtubeMetadataSource: null };
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
    const metadataProvider = normaliseMetadataProvider(args);

    console.log("AnimeVerse safe catalogue growth");
    console.log(`Anime metadata target : top ${animeTarget} by popularity`);
    console.log(`Metadata strategy     : ${metadataProvider === "auto" ? "AniList → Jikan → stored" : metadataProvider}`);
    console.log(`YouTube batch         : offset ${offset}, ${batch} anime`);
    console.log(`Target per anime      : ${perAnime}`);
    console.log(`Search templates      : ${queries}, starting at ${queryOffset + 1}`);
    console.log(`Published-video goal  : ${targetVideos}+`);
    if (dryRun) console.log("Mode                  : DRY RUN for YouTube writes");

    const metadata = await refreshMetadata({
        provider: metadataProvider,
        animeTarget,
        dryRun,
    });

    const inventory = await getAnimeInventory();
    console.log(`\nStored Anime available: ${inventory.total}`);
    console.log(`  AniList-backed       : ${inventory.anilist}`);
    console.log(`  Jikan fallback       : ${inventory.jikan}`);

    if (inventory.total === 0) {
        throw new Error(
            "No Anime documents exist in MongoDB, so YouTube ingestion has nothing safe to target."
        );
    }

    let youtubeMetadataSource = metadata.youtubeMetadataSource;
    let eligibleAnimeCount = youtubeMetadataSource
        ? inventory[youtubeMetadataSource]
        : inventory.total;

    // Jikan may have returned only anime we already had from AniList. In that rare
    // case, source-filtering would produce an empty YouTube batch, so use the full
    // stored catalogue rather than failing pointlessly.
    if (youtubeMetadataSource && eligibleAnimeCount === 0) {
        console.log(
            `No ${youtubeMetadataSource}-backed Anime rows need targeting; using the full stored catalogue.`
        );
        youtubeMetadataSource = null;
        eligibleAnimeCount = inventory.total;
    }

    if (youtubeMetadataSource) {
        console.log(`YouTube metadata scope : ${youtubeMetadataSource} (${eligibleAnimeCount} anime)`);
    } else {
        console.log(`YouTube metadata scope : all stored anime (${eligibleAnimeCount})`);
    }

    if (offset >= eligibleAnimeCount) {
        console.log(
            `\nNothing to process at offset ${offset}: this metadata scope contains ${eligibleAnimeCount} Anime document(s).`
        );

        if (!dryRun) {
            const embeddingResult = runNodeScript("backfillEmbeddings.js", ["--target=all"]);
            if (!embeddingResult.ok) {
                throw new Error(
                    `backfillEmbeddings.js exited with code ${embeddingResult.status ?? "unknown"}`
                );
            }
            await printStats(targetVideos);
        }
        return;
    }

    const effectiveBatch = Math.min(batch, eligibleAnimeCount - offset);
    if (effectiveBatch !== batch) {
        console.log(
            `YouTube batch adjusted : ${batch} → ${effectiveBatch} for the current metadata scope.`
        );
    }

    const ytArgs = [
        `--offset=${offset}`,
        `--limit=${effectiveBatch}`,
        `--per-anime=${perAnime}`,
        `--queries=${queries}`,
        `--query-offset=${queryOffset}`,
        "--total-cap",
    ];
    if (youtubeMetadataSource) ytArgs.push(`--metadata-source=${youtubeMetadataSource}`);
    if (dryRun) ytArgs.push("--dry-run");

    // YouTube quota exhaustion may produce a non-zero exit after valid videos were
    // already inserted. Keep those imports and still backfill their embeddings.
    const youtubeResult = runNodeScript("ingestYouTube.js", ytArgs);
    if (!youtubeResult.ok) {
        console.warn("\n⚠ YouTube ingestion ended with a non-zero status.");
        console.warn(
            "  Existing successful imports are preserved. This commonly means search quota exhaustion or a transient API failure."
        );
    }

    if (dryRun) {
        console.log(
            "\nDry run complete. The YouTube step wrote nothing and embeddings were not changed."
        );
        return;
    }

    const embeddingResult = runNodeScript("backfillEmbeddings.js", ["--target=all"]);
    if (!embeddingResult.ok) {
        throw new Error(
            `backfillEmbeddings.js exited with code ${embeddingResult.status ?? "unknown"}`
        );
    }

    const stats = await printStats(targetVideos);

    if (stats.published < targetVideos) {
        const nextOffset = offset + effectiveBatch;
        console.log("\nNext safe growth suggestion:");

        if (nextOffset < eligibleAnimeCount) {
            console.log(`  npm run grow:catalog -- --offset=${nextOffset}`);
        } else {
            console.log(
                "  This metadata scope has been exhausted for the current search templates."
            );
            console.log(
                "  Use --query-offset=2 on the same offsets for different official-content searches,"
            );
            console.log(
                "  or expand --anime-target if you intentionally want a broader metadata catalogue."
            );
        }
    }
}

main().catch(async (error) => {
    console.error(`\nCatalogue growth failed: ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
});
