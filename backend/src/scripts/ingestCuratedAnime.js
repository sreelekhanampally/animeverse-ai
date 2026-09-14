/**
 * Offline Anime metadata fallback.
 *
 * Used only when external metadata providers are unavailable. It adds missing
 * recognisable titles from a local, reviewed seed and deliberately leaves
 * unknown metadata blank. No API key and no network request are required.
 *
 * Examples:
 *   npm run ingest:curated -- --target-total=160
 *   npm run ingest:curated -- --target-total=160 --dry-run
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Anime } from "../models/anime.model.js";
import { CURATED_ANIME_CATALOG } from "../seeds/curatedAnimeCatalog.js";
import {
    curatedTitleKeys,
    mapCuratedSeedToAnime,
    normalizeCuratedTitle,
} from "../services/curatedAnime.service.js";

const parseArgs = (argv) => {
    const args = {};
    for (const raw of argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
        if (match) args[match[1]] = match[2] === undefined ? true : match[2];
    }
    return args;
};

function collectExistingTitleKeys(animeDocs) {
    const keys = new Set();
    for (const anime of animeDocs) {
        for (const value of [anime?.title?.display, anime?.title?.english, anime?.title?.romaji]) {
            const key = normalizeCuratedTitle(value);
            if (key) keys.add(key);
        }
    }
    return keys;
}

const main = async () => {
    const args = parseArgs(process.argv);
    const dryRun = Boolean(args["dry-run"]);
    const requestedTarget = Number(args["target-total"] ?? args.limit ?? 160);
    const targetTotal = Math.max(1, Math.min(Number.isFinite(requestedTarget) ? requestedTarget : 160, 500));

    await connectDB();

    try {
        const existing = await Anime.find({}, { title: 1, anilistId: 1, metadataSource: 1 }).lean();
        const existingKeys = collectExistingTitleKeys(existing);
        const needed = Math.max(0, targetTotal - existing.length);

        console.log("Offline curated Anime fallback");
        console.log(`  Existing Anime : ${existing.length}`);
        console.log(`  Target total   : ${targetTotal}`);
        console.log(`  Local seeds    : ${CURATED_ANIME_CATALOG.length}`);
        console.log(`  Need to add    : ${needed}`);
        if (dryRun) console.log("  Mode           : DRY RUN (no MongoDB writes)");

        if (needed === 0) {
            console.log("\nCatalogue already meets the requested metadata target. Nothing to add.");
            return;
        }

        let imported = 0;
        let skippedDuplicate = 0;
        const selected = [];

        for (let index = 0; index < CURATED_ANIME_CATALOG.length && selected.length < needed; index += 1) {
            const seed = CURATED_ANIME_CATALOG[index];
            const titleKeys = curatedTitleKeys(seed);
            const duplicate = [...titleKeys].some((key) => existingKeys.has(key));
            if (duplicate) {
                skippedDuplicate += 1;
                continue;
            }

            const doc = mapCuratedSeedToAnime(seed, { rank: index });
            selected.push(doc);
            for (const key of titleKeys) existingKeys.add(key);
        }

        if (dryRun) {
            for (const doc of selected.slice(0, 30)) {
                console.log(`  + would add: ${doc.title.display}`);
            }
            if (selected.length > 30) console.log(`  ... and ${selected.length - 30} more`);
            console.log(`\nWould add ${selected.length}; duplicate seeds skipped: ${skippedDuplicate}.`);
            return;
        }

        for (const doc of selected) {
            const result = await Anime.updateOne(
                { anilistId: doc.anilistId },
                { $setOnInsert: doc },
                { upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
            if (result.upsertedCount > 0) {
                imported += 1;
                console.log(`  ✓ imported  ${doc.title.display}`);
            } else {
                console.log(`  ↻ exists    ${doc.title.display}`);
            }
        }

        const finalCount = await Anime.countDocuments();
        console.log("\nCurated fallback summary");
        console.log(`  Imported          : ${imported}`);
        console.log(`  Duplicate skipped : ${skippedDuplicate}`);
        console.log(`  Anime total       : ${finalCount}`);
        if (finalCount < targetTotal) {
            console.log(
                `  Note              : local reviewed seed exhausted before target ${targetTotal}; no metadata was fabricated.`
            );
        }
    } finally {
        await mongoose.disconnect();
    }
};

main().catch(async (error) => {
    console.error(`\nCurated Anime ingestion failed: ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
});
