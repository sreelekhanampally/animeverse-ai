/**
 * Embedding backfill CLI.
 *
 *   npm run backfill:embeddings -- --dry-run
 *   npm run backfill:embeddings -- --dry-run --limit=5 --verbose
 *   npm run backfill:embeddings -- --target=anime --batch-size=20
 *   npm run backfill:embeddings -- --target=videos --limit=10
 *   npm run backfill:embeddings -- --force
 *
 * Generates 1536-dimensional text-embedding-3-small vectors for Anime and Video
 * documents and stamps each with the model, dimension count, text version, a
 * timestamp and a SHA-256 of the exact text embedded.
 *
 * A script rather than an endpoint, matching ingestAnime.js and ingestYouTube.js:
 * this spends money per document and rewrites a whole collection, which is an
 * operator action. There is no admin/role concept on the User model to protect an
 * HTTP equivalent with.
 *
 * WHAT IT WILL NOT TOUCH
 * ----------------------
 * Writes are `$set` of embedding fields only — embedding, embeddingModel,
 * embeddingDimensions, embeddingVersion, embeddingGeneratedAt, embeddingTextHash.
 * Nothing else, in either collection. It never deletes a document, never touches a
 * User, never writes sourceType / videoFile / externalVideoId / owner / thumbnail,
 * and never edits AniList-sourced Anime metadata. Old incompatible vectors are
 * overwritten in place when a document is reprocessed and otherwise left alone —
 * no bulk deletion, since a stale vector is inert once `isSearchableEmbedding`
 * rejects it.
 *
 * YOUTUBE
 * -------
 * A YouTube video is embedded from its persisted metadata alone. Nothing is
 * downloaded, re-hosted, converted, extracted or sent to Whisper, and no transcript
 * is generated for any document. A stored transcript participates only for
 * non-YouTube videos that already have a legitimate one — see isTranscriptEligible.
 *
 * Source type is decided by `sourceType`, never by owner: a YouTube video imported
 * under the AnimeVerse Official account is sourceType "youtube" and is treated as
 * such here.
 *
 * SAFETY
 * ------
 * --dry-run writes nothing and needs no API key. Without --force, a document whose
 * stored hash already matches the freshly built text is skipped, so an interrupted
 * run resumes where it stopped and a completed run costs nothing to repeat.
 *
 * Exits non-zero on any failure, so a wrapper can detect it.
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Anime } from "../models/anime.model.js";
import { Video } from "../models/video.model.js";
import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    EmbeddingUnavailableError,
    describeEmbeddingState,
    generateEmbedding,
    hasEmbeddingProvider,
    isSearchableEmbedding,
} from "../services/embedding.service.js";
import {
    buildAnimeEmbeddingText,
    buildVideoEmbeddingText,
    hashEmbeddingText,
    isTranscriptEligible,
} from "../utils/embeddingText.js";

/** Same flag parser as the two existing ingestion scripts. */
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

const line = (char = "-") => console.log(char.repeat(68));

/**
 * The projection needed to decide whether a document must be reprocessed.
 *
 * Every embedding field is select:false, so each one has to be asked for
 * explicitly. The vector itself is included because `isSearchableEmbedding`
 * verifies its real length rather than trusting the stored dimension count.
 */
const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingGeneratedAt +embeddingTextHash";

/**
 * Decides what to do with one document, without any I/O.
 *
 * Returns { action, reason, text }. Separated from the write path so the dry run
 * and the real run make the same decision through the same code — a dry run that
 * reasoned differently from the real run would be worthless as a preview.
 */
function planDocument({ doc, text, force }) {
    if (!text.trim()) {
        // Nothing meaningful to embed. Not a failure: a Video requires a title and
        // description, so this is essentially unreachable, but embedding whitespace
        // would produce a vector that matches everything equally.
        return { action: "skip", reason: "no embeddable text", text };
    }

    const hash = hashEmbeddingText(text);

    if (force) {
        return { action: "embed", reason: "forced", text, hash };
    }

    // Already correct AND built from identical text -> nothing to do. Both halves
    // are required: a valid vector over changed text is stale, and a matching hash
    // with a stale model is unusable.
    if (isSearchableEmbedding(doc) && doc.embeddingTextHash === hash) {
        return { action: "skip", reason: "up to date", text, hash };
    }

    const state = describeEmbeddingState(doc);
    const reason = state
        ? state // missing / wrong dimensions / wrong model / wrong version
        : "content changed since last embedding";

    return { action: "embed", reason, text, hash };
}

/**
 * Processes one collection in batches.
 *
 * Batching is by database cursor, not by API call: each document is embedded in its
 * own request because the endpoint's per-input token ceiling makes a batched call
 * fail wholesale on one long transcript, and a partial failure would be
 * indistinguishable from a total one. The batch size therefore bounds memory and
 * gives a natural progress/reporting checkpoint.
 */
async function processCollection({ label, Model, buildText, dryRun, force, batchSize, limit, verbose }) {
    const report = {
        label,
        scanned: 0,
        embedded: 0,
        skippedUpToDate: 0,
        skippedNoText: 0,
        failed: 0,
        failures: [],
        reasons: new Map(),
        withTranscript: 0,
        youtube: 0,
        cloudinary: 0,
    };

    const isVideo = Model === Video;

    // Videos need their linked anime for the embedding text; Anime documents need
    // nothing extra. Populating only the fields the builder actually reads keeps the
    // payload small and makes the whitelist visible at the query level too.
    const query = Model.find({}).select(EMBEDDING_FIELDS).sort({ _id: 1 });
    if (isVideo) {
        query.populate("anime", "title genres studios season seasonYear format status description characters");
    }
    if (limit) query.limit(limit);

    const cursor = query.lean().cursor({ batchSize });

    let batch = [];
    const flush = async () => {
        if (!batch.length) return;

        for (const doc of batch) {
            const text = buildText(doc);
            const plan = planDocument({ doc, text, force });

            if (plan.action === "skip") {
                if (plan.reason === "no embeddable text") report.skippedNoText += 1;
                else report.skippedUpToDate += 1;
                if (verbose) {
                    console.log(`    - skip     ${describeDoc(doc, isVideo)} — ${plan.reason}`);
                }
                continue;
            }

            report.reasons.set(plan.reason, (report.reasons.get(plan.reason) || 0) + 1);

            if (dryRun) {
                // The dry run stops here: it has proven it can build the text and
                // decided the document needs work, without an API call or a write.
                report.embedded += 1;
                if (verbose) {
                    console.log(
                        `    ~ would embed ${describeDoc(doc, isVideo)} — ${plan.reason} (${text.length} chars)`
                    );
                }
                continue;
            }

            try {
                const fields = await generateEmbedding(text);

                // The ONLY write in this script. $set of embedding fields, nothing
                // else — no media field, no metadata field, no user document.
                await Model.updateOne({ _id: doc._id }, { $set: fields });

                report.embedded += 1;
                if (verbose) {
                    console.log(`    + embedded ${describeDoc(doc, isVideo)} — ${plan.reason}`);
                }
            } catch (error) {
                // An unconfigured provider is fatal for the whole run, not a
                // per-document failure — continuing would emit one identical error
                // per document and waste the operator's attention.
                if (error instanceof EmbeddingUnavailableError) throw error;

                report.failed += 1;
                report.failures.push({ id: String(doc._id), label: describeDoc(doc, isVideo), reason: error.message });
                console.log(`    x failed   ${describeDoc(doc, isVideo)} — ${error.message}`);
            }
        }

        batch = [];
    };

    for await (const doc of cursor) {
        report.scanned += 1;

        if (isVideo) {
            // Counted from sourceType alone — never inferred from owner.
            if ((doc.sourceType || "cloudinary") === "youtube") report.youtube += 1;
            else report.cloudinary += 1;
            if (isTranscriptEligible(doc)) report.withTranscript += 1;
        }

        batch.push(doc);
        if (batch.length >= batchSize) await flush();
    }
    await flush();

    return report;
}

/** Short identifying label for log lines. Never prints a URL or an owner. */
const describeDoc = (doc, isVideo) => {
    if (isVideo) {
        const source = (doc.sourceType || "cloudinary") === "youtube" ? "yt" : "cl";
        return `[${source}] ${String(doc.title || "(untitled)").slice(0, 52)}`;
    }
    return String(doc.title?.display || doc.title?.romaji || "(untitled)").slice(0, 56);
};

function printReport(report, { dryRun }) {
    line("=");
    console.log(`  ${report.label}`);
    line("=");
    console.log(`  Scanned            : ${report.scanned}`);
    console.log(`  ${dryRun ? "Would embed       " : "Embedded          "} : ${report.embedded}`);
    console.log(`  Skipped (current)  : ${report.skippedUpToDate}`);
    if (report.skippedNoText) console.log(`  Skipped (no text)  : ${report.skippedNoText}`);
    console.log(`  Failed             : ${report.failed}`);

    if (report.youtube || report.cloudinary) {
        console.log(`  YouTube / Cloudinary: ${report.youtube} / ${report.cloudinary}`);
        console.log(`  With usable transcript: ${report.withTranscript}`);
    }

    if (report.reasons.size) {
        console.log("\n  Reasons:");
        for (const [reason, count] of [...report.reasons].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(count).padStart(4)} x ${reason}`);
        }
    }

    if (report.failures.length) {
        console.log("\n  Failures:");
        for (const failure of report.failures.slice(0, 20)) {
            console.log(`    - ${failure.label}: ${failure.reason}`);
        }
        if (report.failures.length > 20) {
            console.log(`    ... and ${report.failures.length - 20} more`);
        }
    }
    line("=");
}

const run = async () => {
    const args = parseArgs(process.argv);
    const dryRun = Boolean(args["dry-run"]);
    const force = Boolean(args.force);
    const verbose = Boolean(args.verbose);

    // Bounded: 1..100. A larger cursor batch buys nothing here because each document
    // is embedded in its own request anyway.
    const batchSize = Math.max(1, Math.min(Number(args["batch-size"]) || 25, 100));
    const limit = args.limit ? Math.max(1, Number(args.limit)) : undefined;

    const target = args.target === true ? "all" : String(args.target || "all").toLowerCase();
    if (!["all", "videos", "anime"].includes(target)) {
        console.error(`Unknown --target="${target}". Use one of: all, videos, anime.`);
        return 1;
    }

    console.log(
        `${dryRun ? "DRY RUN — " : ""}Embedding backfill\n` +
            `  model      : ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dimensions)\n` +
            `  version    : ${EMBEDDING_VERSION}\n` +
            `  target     : ${target}\n` +
            `  batch size : ${batchSize}${limit ? `\n  limit      : ${limit} per collection` : ""}` +
            `${force ? "\n  force      : re-embedding every document, ignoring stored hashes" : ""}`
    );

    /**
     * A real run without a key must stop before connecting or reading anything —
     * failing on the first document instead would be noisier and no more informative.
     * A dry run deliberately does not require the key: proving the text builders work
     * against real data is exactly what it is for.
     */
    if (!dryRun && !hasEmbeddingProvider()) {
        console.error(
            "\nOPENAI_API_KEY is not configured, so no embeddings can be generated.\n" +
                "No fake or placeholder vectors will be written.\n" +
                "Set OPENAI_API_KEY, or use --dry-run to preview what would be embedded."
        );
        return 1;
    }
    if (dryRun && !hasEmbeddingProvider()) {
        console.log("\n  note       : no OPENAI_API_KEY set — dry run still previews text and decisions.");
    }

    /**
     * A dry run must be genuinely read-only, and index creation is a write.
     *
     * Mongoose's autoIndex defaults to true and builds every index declared on a
     * schema the first time that model is used. This file's models declare a new
     * { embeddingModel, embeddingVersion } index, so without this line a dry run
     * would silently create it on the live cluster — while printing "Nothing was
     * written to MongoDB", which would be a false claim.
     *
     * Disabled only for the dry run. A real run still builds the index, which is
     * where it belongs: that run is writing anyway, and the index is what keeps
     * subsequent runs from scanning the whole collection.
     */
    if (dryRun) mongoose.set("autoIndex", false);

    await connectDB();

    const reports = [];

    // Anime first: it is reference data, and a Video's text embeds its linked anime,
    // so doing anime first keeps the ordering intuitive when reading the output.
    if (target === "all" || target === "anime") {
        console.log("\nAnime\n" + "-".repeat(68));
        reports.push(
            await processCollection({
                label: "Anime embeddings",
                Model: Anime,
                buildText: (doc) => buildAnimeEmbeddingText(doc),
                dryRun,
                force,
                batchSize,
                limit,
                verbose,
            })
        );
    }

    if (target === "all" || target === "videos") {
        console.log("\nVideos\n" + "-".repeat(68));
        reports.push(
            await processCollection({
                label: "Video embeddings",
                Model: Video,
                // A populated `anime` is passed explicitly rather than relied on
                // implicitly, so the builder never has to guess.
                buildText: (doc) => buildVideoEmbeddingText(doc, { anime: doc.anime }),
                dryRun,
                force,
                batchSize,
                limit,
                verbose,
            })
        );
    }

    console.log("");
    for (const report of reports) printReport(report, { dryRun });

    const totalEmbedded = reports.reduce((sum, r) => sum + r.embedded, 0);
    const totalFailed = reports.reduce((sum, r) => sum + r.failed, 0);

    if (dryRun) {
        console.log("\n  Nothing was written to MongoDB. No embeddings were generated.");
        console.log(`  A real run would embed ${totalEmbedded} document(s).`);
        if (totalEmbedded) {
            console.log("  To apply: npm run backfill:embeddings");
        }
    } else {
        console.log(`\n  Documents updated: ${totalEmbedded} (embedding fields only).`);
        console.log("  No document was deleted. No user, media or metadata field was modified.");
    }
    line("=");

    return totalFailed > 0 ? 1 : 0;
};

let exitCode = 1;
try {
    exitCode = await run();
} catch (error) {
    if (error instanceof EmbeddingUnavailableError) {
        console.error(`\n${error.message}`);
        console.error("No fake vectors were written.");
    } else {
        console.error("\nBackfill aborted:", error.message);
    }
    exitCode = 1;
} finally {
    // Always release the connection; a dangling socket would hang the process.
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
process.exit(exitCode);
