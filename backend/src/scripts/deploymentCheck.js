import "dotenv/config";
import process from "node:process";
import { assertEnvironment, validateEnvironment } from "../config/env.js";
import connectDB, { disconnectDB } from "../db/index.js";

const wantDb = process.argv.includes("--db");
const failures = [];
const warnings = [];

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
    failures.push(`Node.js 20+ is required; current runtime is ${process.version}`);
}

const env = validateEnvironment({ mode: "deployment" });
failures.push(...env.errors);
warnings.push(...env.warnings);

const checks = [
    ["Runtime", failures.some((item) => item.startsWith("Node.js")) ? "FAIL" : "PASS"],
    ["Environment", env.ok ? "PASS" : "FAIL"],
    ["Cloudinary", env.features.cloudinary ? "PASS" : "FAIL"],
    ["Gemini", env.features.gemini ? "READY" : "FALLBACK"],
    ["Embedding provider", env.features.embeddingProvider],
    ["Chat provider", env.features.chatProvider],
];

console.log("AnimeVerse deployment check");
console.log("----------------------------");
for (const [name, status] of checks) console.log(`${name.padEnd(20)} ${status}`);

if (wantDb && failures.length === 0) {
    try {
        // Startup validation is intentionally re-used here so the DB probe cannot
        // run with an invalid URI or missing auth configuration.
        assertEnvironment({ mode: "startup" });
        const connection = await connectDB();
        await connection.db.admin().ping();
        console.log(`${"MongoDB ping".padEnd(20)} PASS`);
    } catch (error) {
        failures.push(`MongoDB ping failed: ${error?.message || error}`);
        console.log(`${"MongoDB ping".padEnd(20)} FAIL`);
    } finally {
        await disconnectDB().catch(() => {});
    }
}

if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
}

if (failures.length) {
    console.error("\nDeployment blockers:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
} else {
    console.log("\nDeployment configuration looks ready.");
}
