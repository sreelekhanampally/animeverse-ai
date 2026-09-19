/**
 * Catalogue quality audit.
 *
 * Safe defaults:
 *   npm run catalog:audit
 *     - MongoDB only
 *     - no YouTube API calls
 *     - no database writes
 *
 * Live verification:
 *   npm run catalog:audit:live
 *     - batches stored YouTube ids through videos.list (50 ids/call)
 *     - does NOT call search.list
 *     - re-applies the current ingestion quality filter to fresh metadata
 *
 * Reversible cleanup:
 *   npm run catalog:quarantine
 *     - same live audit
 *     - unpublishes only high-confidence failures
 *     - never deletes a video
 *     - borderline relevance/score failures remain review-only
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import connectDB, { disconnectDB } from "../db/index.js";
import { auditCatalogQuality } from "../services/catalogQuality.service.js";

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

const line = (char = "-") => console.log(char.repeat(72));
const pct = (value, total) => (total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%");

function printCompactRows(title, rows, formatter, limit = 12) {
    if (!rows?.length) return;
    console.log(`\n${title}`);
    for (const row of rows.slice(0, limit)) console.log(`  - ${formatter(row)}`);
    if (rows.length > limit) console.log(`  ... ${rows.length - limit} more in JSON report`);
}

function printReport(report, { summaryOnly = false, quarantine = false } = {}) {
    const scanned = report.scope.publishedYoutubeVideosScanned;

    line("=");
    console.log("AnimeVerse catalogue quality");
    line("=");
    console.log(`Mode                        : ${report.mode}`);
    console.log(`Anime documents             : ${report.scope.anime}`);
    console.log(`Published YouTube scanned   : ${scanned}`);
    console.log(
        `Structurally clean          : ${scanned - report.summary.structuralIssueVideos}/${scanned} ` +
            `(${pct(scanned - report.summary.structuralIssueVideos, scanned)})`
    );
    console.log(
        `Searchable embeddings       : ${scanned - report.summary.staleOrMissingEmbeddings}/${scanned} ` +
            `(${pct(scanned - report.summary.staleOrMissingEmbeddings, scanned)})`
    );
    console.log(`Duplicate-title groups      : ${report.summary.duplicateTitleGroups}`);
    console.log(`Anime with no YouTube video : ${report.summary.animeWithNoPublishedYouTube}`);
    console.log(`Anime below 3-video coverage: ${report.summary.animeUnderRecommendedCoverage}`);
    console.log(`Anime above safety ceiling  : ${report.summary.animeOverCeiling}`);
    console.log(`Content-mix concentration   : ${report.summary.animeWithContentConcentration}`);
    console.log(`Entity-link review          : ${report.summary.associationReviewCandidates}`);
    console.log(`Known entity collisions     : ${report.summary.associationCollisionCandidates}`);

    console.log("\nContent mix");
    for (const [kind, count] of Object.entries(report.contentKinds || {})) {
        console.log(`  ${kind.padEnd(10)} ${String(count).padStart(4)}`);
    }

    console.log("\nAnime metadata completeness");
    for (const [source, bucket] of Object.entries(report.metadataBySource || {})) {
        console.log(
            `  ${source.padEnd(10)} ${String(bucket.count).padStart(3)} anime · ` +
                `${bucket.averageCompleteness}% avg · ` +
                `${bucket.missingDescription} no description · ${bucket.missingGenres} no genres`
        );
    }

    if (report.live) {
        console.log("\nLive YouTube revalidation");
        console.log(`  Approved                  : ${report.summary.liveApproved}`);
        console.log(`  Needs human review        : ${report.summary.liveNeedsReview}`);
        console.log(`  Safe quarantine candidate : ${report.summary.liveQuarantineCandidates}`);
        console.log(`  Metadata drift            : ${report.summary.liveMetadataDrift}`);
        console.log(`  videos.list calls         : ${report.live.quota?.videos || 0}`);
        console.log(`  search.list calls         : ${report.live.quota?.search || 0}`);
        if (quarantine) console.log(`  Unpublished this run      : ${report.summary.quarantined}`);
    }

    if (!summaryOnly) {
        printCompactRows(
            "Coverage gaps",
            [...report.coverage.zero, ...report.coverage.undercovered],
            (row) => `${row.title} — ${row.count} published YouTube video(s)`
        );
        printCompactRows(
            "Possible duplicate uploads",
            report.duplicateGroups,
            (row) => `${row.count} × ${row.videos[0]?.title || row.fingerprint}`
        );
        printCompactRows(
            "Content-mix concentration",
            report.coverage.concentrated,
            (row) => `${row.title} — ${Math.round(row.dominantShare * 100)}% ${row.dominantKind}`
        );
        printCompactRows(
            "Anime/video links to review",
            report.associations?.review,
            (row) => `${row.animeTitle} ← ${row.title} — ${row.reason}`
        );
        printCompactRows(
            "Known cross-title collisions",
            report.associations?.collisions,
            (row) => `${row.animeTitle} ← ${row.title} — ${row.reason}`
        );
        if (report.live) {
            printCompactRows(
                "Review manually",
                report.live.review,
                (row) => `${row.title} — ${row.reason}`
            );
            printCompactRows(
                quarantine ? "Quarantined / quarantine candidates" : "Safe quarantine candidates",
                report.live.quarantineCandidates,
                (row) => `${row.title} — ${row.reason}`
            );
            printCompactRows(
                "YouTube metadata changed",
                report.live.metadataDrift,
                (row) => `${row.title} — ${row.fields.join(", ")}`
            );
        }
    }

    console.log("\nRecommended next step");
    if (report.summary.staleOrMissingEmbeddings > 0) {
        console.log("  npm run backfill:embeddings -- --target=all");
    } else if (report.summary.associationCollisionCandidates > 0 || report.summary.associationReviewCandidates > 0) {
        console.log("  npm run catalog:associations");
    } else if (report.summary.animeWithNoPublishedYouTube > 0 || report.summary.animeUnderRecommendedCoverage > 0) {
        console.log("  npm run grow:catalog -- --metadata-provider=stored --quality-first");
    } else if (!report.live) {
        console.log("  npm run catalog:audit:live");
    } else if (report.summary.liveQuarantineCandidates > 0) {
        console.log("  Review the JSON report, then run: npm run catalog:quarantine");
    } else {
        console.log("  Catalogue health looks good. Add content only when it improves coverage or variety.");
    }
    line("=");
}

async function writeReport(report, requestedPath) {
    const defaultPath = path.resolve(process.cwd(), ".reports", "catalog-quality-latest.json");
    const output = requestedPath ? path.resolve(process.cwd(), String(requestedPath)) : defaultPath;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report written to: ${path.relative(process.cwd(), output) || output}`);
    return output;
}

async function main() {
    const args = parseArgs(process.argv);
    const live = Boolean(args.live);
    const quarantine = Boolean(args.quarantine);
    const summaryOnly = Boolean(args["summary-only"]);
    const noJson = Boolean(args["no-json"]);
    const limit = positiveInt(args.limit, 0);

    if (quarantine && !live) {
        throw new Error("--quarantine requires --live. Use npm run catalog:quarantine.");
    }

    await connectDB();
    const report = await auditCatalogQuality({ live, limit, quarantine });
    printReport(report, { summaryOnly, quarantine });

    if (!noJson) {
        const jsonPath = args.json && args.json !== true ? String(args.json) : undefined;
        await writeReport(report, jsonPath);
    }

    return 0;
}

let exitCode = 1;
try {
    exitCode = await main();
} catch (error) {
    console.error(`\nCatalogue quality audit failed: ${error.message}`);
    exitCode = 1;
} finally {
    if (mongoose.connection.readyState !== 0) await disconnectDB();
}
process.exit(exitCode);
