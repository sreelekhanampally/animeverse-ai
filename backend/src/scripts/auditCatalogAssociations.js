/**
 * Focused Anime ↔ YouTube association repair.
 *
 * Default is a dry run:
 *   npm run catalog:associations
 *
 * Apply only reviewed/high-confidence entity collisions:
 *   npm run catalog:associations:apply
 *
 * The apply mode never deletes rows. It only sets isPublished=false for
 * collision candidates such as D.Gray-man ← The Gray Man.
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import connectDB, { disconnectDB } from "../db/index.js";
import { auditCatalogAssociations } from "../services/catalogQuality.service.js";

const parseArgs = (argv) => {
    const args = {};
    for (const raw of argv.slice(2)) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
        if (match) args[match[1]] = match[2] === undefined ? true : match[2];
    }
    return args;
};

const positiveInt = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
};

const line = () => console.log("=".repeat(72));

function printRows(title, rows, limit = 20) {
    if (!rows?.length) return;
    console.log(`\n${title}`);
    for (const row of rows.slice(0, limit)) {
        console.log(`  - ${row.title} → ${row.reason}`);
    }
    if (rows.length > limit) console.log(`  ... ${rows.length - limit} more in JSON report`);
}

async function writeReport(report, requestedPath) {
    const fallback = path.resolve(process.cwd(), ".reports", "catalog-association-repair-latest.json");
    const output = requestedPath ? path.resolve(process.cwd(), String(requestedPath)) : fallback;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nReport written to: ${path.relative(process.cwd(), output) || output}`);
}

async function main() {
    const args = parseArgs(process.argv);
    const apply = Boolean(args.apply);
    const limit = positiveInt(args.limit, 0);

    await connectDB();
    const report = await auditCatalogAssociations({ apply, limit });

    line();
    console.log("AnimeVerse anime/video association audit");
    line();
    console.log(`Mode                    : ${report.mode}`);
    console.log(`Published YouTube scan  : ${report.scanned}`);
    console.log(`Strong/current links    : ${report.keep}`);
    console.log(`Needs human review      : ${report.review.length}`);
    console.log(`Known collisions        : ${report.collisions.length}`);
    console.log(`Unpublished this run    : ${report.unpublished}`);
    console.log(`videos.list calls       : ${report.quota?.videos || 0}`);
    console.log(`search.list calls       : ${report.quota?.search || 0}`);

    printRows("Review manually", report.review);
    printRows(apply ? "Unpublished known collisions" : "Safe association quarantine candidates", report.collisions);

    console.log("\nNext step");
    if (!apply && report.collisions.length) {
        console.log("  Review the JSON report, then run: npm run catalog:associations:apply");
    } else if (report.review.length) {
        console.log("  Review the remaining ambiguous links manually; they are intentionally not auto-unpublished.");
    } else {
        console.log("  Anime/video associations look clean under the current entity rules.");
    }
    line();

    const jsonPath = args.json && args.json !== true ? String(args.json) : undefined;
    await writeReport(report, jsonPath);
    return 0;
}

let exitCode = 1;
try {
    exitCode = await main();
} catch (error) {
    console.error(`\nAssociation audit failed: ${error.message}`);
    exitCode = 1;
} finally {
    if (mongoose.connection.readyState !== 0) await disconnectDB();
}
process.exit(exitCode);
