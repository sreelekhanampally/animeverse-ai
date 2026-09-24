import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { buildRagIndex, getRagIndexStatus } from "../services/ragIndex.service.js";

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
    const prefix = `--${name}=`;
    const hit = [...args].find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
};

const dryRun = args.has("--dry-run");
const prune = !args.has("--no-prune");
const batchSize = Number.parseInt(valueArg("batch-size", "25"), 10) || 25;

try {
    await connectDB();

    console.log("\nAnimeVerse RAG index");
    console.log("=".repeat(72));
    console.log(`Mode            : ${dryRun ? "dry-run" : "write"}`);
    console.log(`Batch size      : ${batchSize}`);
    console.log(`Prune stale     : ${prune}`);

    const result = await buildRagIndex({ dryRun, batchSize, prune });

    console.log("-".repeat(72));
    console.log(`Index version   : ${result.indexVersion}`);
    console.log(`Anime sources   : ${result.sourceCounts.anime}`);
    console.log(`Video sources   : ${result.sourceCounts.videos}`);
    console.log(`Desired chunks  : ${result.desiredChunks}`);
    console.log(`Existing chunks : ${result.existingChunks}`);
    console.log(`Unchanged       : ${result.unchanged}`);
    console.log(`Reactivated     : ${result.reactivated}`);
    console.log(`${dryRun ? "Would embed" : "Embedded"}        : ${dryRun ? result.wouldEmbed : result.embedded}`);
    console.log(`Deactivated     : ${result.deactivated}`);
    console.log(`Errors          : ${result.errors.length}`);

    if (result.errors.length) {
        for (const error of result.errors.slice(0, 10)) {
            console.error(`  - ${error.chunkKey}: ${error.message}`);
        }
        if (result.errors.length > 10) {
            console.error(`  ... ${result.errors.length - 10} more`);
        }
        process.exitCode = 1;
    }

    if (!dryRun) {
        const status = await getRagIndexStatus();
        console.log("-".repeat(72));
        console.log(`Active chunks   : ${status.activeChunks}`);
        console.log(`Embedded chunks : ${status.embeddedChunks}`);
        console.log(`Coverage        : ${status.embeddingCoverage}%`);
        console.log(`By source       : ${JSON.stringify(status.bySource)}`);
    }

    console.log("=".repeat(72));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect().catch(() => {});
}
