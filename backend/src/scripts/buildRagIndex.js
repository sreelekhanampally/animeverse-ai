import "dotenv/config";
import connectDB, { disconnectDB } from "../db/index.js";
import { rebuildRagIndex } from "../services/ragIndex.service.js";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");

const main = async () => {
    await connectDB();

    console.log("=".repeat(72));
    console.log("AnimeVerse RAG index");
    console.log("=".repeat(72));
    console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);

    const summary = await rebuildRagIndex({ dryRun });

    console.log(JSON.stringify(summary, null, 2));
    if (!dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectDB().catch(() => {});
    });
