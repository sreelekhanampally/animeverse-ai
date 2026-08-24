/**
 * End-to-end verification of GET /api/v1/stats.
 *
 * Runs the real express app and the real controller, but against a THROWAWAY
 * database (dropped at the end), so the application's own data is never written
 * to. This is what makes it safe to assert on exact numbers and to prove the
 * counts react to inserts and deletes.
 *
 *   node tests/platformStats.verify.mjs
 *
 * Requires MONGODB_URI (read from .env, same as the server).
 */

import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { User } from "../src/models/user.model.js";
import { Video } from "../src/models/video.model.js";

const TEMP_DB = "animeverse_stats_verify";
const PORT = 8010;
const BASE = `http://127.0.0.1:${PORT}/api/v1/stats`;

const getStats = async () => {
    const r = await fetch(BASE);
    assert.equal(r.status, 200, "endpoint must answer 200 without any auth");
    const body = await r.json();
    assert.equal(body.success, true);
    return body.data;
};

const makeVideo = (over) => ({
    title: "t",
    description: "d",
    thumbnail: "https://example.invalid/t.jpg",
    videoFile: "https://example.invalid/v.mp4",
    ...over,
});

let server;
let passed = 0;
const step = (label, fn) =>
    fn().then(() => {
        passed += 1;
        console.log(`  ok  ${label}`);
    });

try {
    await mongoose.connect(`${process.env.MONGODB_URI}/${TEMP_DB}`, {
        serverSelectionTimeoutMS: 25000,
    });
    assert.equal(mongoose.connection.name, TEMP_DB, "must NOT be the app database");
    // Guarantees a clean slate even if a previous run died before dropping.
    await mongoose.connection.dropDatabase();
    await new Promise((res) => {
        server = app.listen(PORT, res);
    });
    console.log(`Verifying against throwaway db "${TEMP_DB}"\n`);

    await step("empty database -> 0 / 0 (no crash, no null creator)", async () => {
        assert.deepEqual(await getStats(), { videosCount: 0, creatorsCount: 0 });
    });

    const [userA, userB, userC] = await User.create([
        { username: "a", email: "a@x.invalid", fullName: "A", avatar: "x", password: "p" },
        { username: "b", email: "b@x.invalid", fullName: "B", avatar: "x", password: "p" },
        { username: "c", email: "c@x.invalid", fullName: "C", avatar: "x", password: "p" },
    ]);
    const orphanId = new mongoose.Types.ObjectId(); // an owner id with no User

    await step("a registered user who never uploaded is not a creator", async () => {
        assert.deepEqual(await getStats(), { videosCount: 0, creatorsCount: 0 });
    });

    const twoOfA = await Video.create([
        makeVideo({ owner: userA._id }),
        makeVideo({ owner: userA._id }),
    ]);

    await step("two videos from one uploader -> creator counted once", async () => {
        assert.deepEqual(await getStats(), { videosCount: 2, creatorsCount: 1 });
    });

    await Video.create(makeVideo({ owner: userB._id }));

    await step("a second uploader increments creatorsCount", async () => {
        assert.deepEqual(await getStats(), { videosCount: 3, creatorsCount: 2 });
    });

    await Video.create(makeVideo({ owner: userC._id, isPublished: false }));

    await step("unpublished video counts toward neither total", async () => {
        assert.deepEqual(await getStats(), { videosCount: 3, creatorsCount: 2 });
    });

    await Video.create(makeVideo({ owner: null }));

    await step("ownerless video does not create a phantom creator", async () => {
        assert.deepEqual(await getStats(), { videosCount: 4, creatorsCount: 2 });
    });

    await Video.create(makeVideo({ owner: orphanId }));

    await step("owner id with no surviving User is not counted as a creator", async () => {
        assert.deepEqual(await getStats(), { videosCount: 5, creatorsCount: 2 });
    });

    await Video.deleteOne({ _id: twoOfA[0]._id });

    await step("deleting one of A's two videos drops videosCount, keeps A a creator", async () => {
        assert.deepEqual(await getStats(), { videosCount: 4, creatorsCount: 1 + 1 });
    });

    await Video.deleteOne({ _id: twoOfA[1]._id });

    await step("deleting A's last video removes A from creatorsCount", async () => {
        assert.deepEqual(await getStats(), { videosCount: 3, creatorsCount: 1 });
    });

    await Video.updateOne({ owner: userC._id }, { $set: { isPublished: true } });

    await step("publishing C's draft adds both the video and C as a creator", async () => {
        assert.deepEqual(await getStats(), { videosCount: 4, creatorsCount: 2 });
    });

    console.log(`\nAll ${passed} assertions passed.`);
} finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === TEMP_DB) {
        await mongoose.connection.dropDatabase();
        console.log(`Dropped throwaway db "${TEMP_DB}".`);
    }
    if (server) await new Promise((res) => server.close(res));
    await mongoose.disconnect();
}
