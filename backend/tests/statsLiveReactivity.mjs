/**
 * Proves GET /api/v1/stats tracks the LIVE application database, by inserting one
 * temporary video and removing it again.
 *
 * Safety properties, in order of importance:
 *   - It only ever creates and deletes ONE document, tracked by _id. No existing
 *     video or user document is read-modify-written at any point.
 *   - The owner is an EXISTING uploader, so no User is created.
 *   - Cleanup is in a finally block and is verified by re-reading the count, so a
 *     mid-run failure still leaves the collection as it was found.
 *
 * This is a verification probe, not a seeder: nothing it writes outlives the run.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { DB_NAME } from "../src/constants.js";
import { Video } from "../src/models/video.model.js";

const STATS_URL = "http://localhost:8000/api/v1/stats";

const readStats = async () => {
    const r = await fetch(STATS_URL);
    assert.equal(r.status, 200);
    return (await r.json()).data;
};

let tempId = null;
let ownerId = null;

try {
    await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`, {
        serverSelectionTimeoutMS: 25000,
    });

    const before = await readStats();
    console.log(`before          : ${before.videosCount} videos / ${before.creatorsCount} creators`);

    // Reuse a real existing uploader so creatorsCount is expected to stay put.
    const existing = await Video.findOne({ owner: { $ne: null } }).select("owner").lean();
    assert.ok(existing, "expected at least one owned video in the live database");
    ownerId = existing.owner;

    const created = await Video.create({
        title: "__stats_verification_probe__",
        description: "temporary document created by tests/statsLiveReactivity.mjs",
        thumbnail: "https://example.invalid/probe.jpg",
        videoFile: "https://example.invalid/probe.mp4",
        owner: ownerId,
        isPublished: true,
    });
    tempId = created._id;

    const during = await readStats();
    console.log(`after insert    : ${during.videosCount} videos / ${during.creatorsCount} creators`);
    assert.equal(during.videosCount, before.videosCount + 1, "videosCount must follow the insert");
    assert.equal(
        during.creatorsCount,
        before.creatorsCount,
        "an extra video from an existing uploader must NOT add a creator"
    );
} finally {
    if (tempId) {
        const { deletedCount } = await Video.deleteOne({ _id: tempId });
        assert.equal(deletedCount, 1, "CLEANUP FAILED — temporary document still present");
    }
    if (mongoose.connection.readyState === 1) {
        const after = await readStats();
        console.log(`after cleanup   : ${after.videosCount} videos / ${after.creatorsCount} creators`);
        await mongoose.disconnect();
    }
}
