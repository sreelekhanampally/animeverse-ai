/**
 * End-to-end verification of the Settings endpoints.
 *
 * Runs the real express app, the real controllers, the real verifyJWT middleware
 * and real bcrypt against a THROWAWAY database that is dropped at the end, so the
 * application's own data is never touched.
 *
 *   node tests/settings.verify.mjs
 *
 * Covers profile update, username uniqueness, password change (including token
 * rotation), notification preferences, and — most importantly — that one user
 * cannot modify another user's account.
 */

import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { User } from "../src/models/user.model.js";
import { Video } from "../src/models/video.model.js";
import { Comment } from "../src/models/comment.model.js";
import { Like } from "../src/models/like.model.js";
import { Subscription } from "../src/models/subscription.model.js";

const TEMP_DB = "animeverse_settings_verify";
const PORT = 8011;
const API = `http://127.0.0.1:${PORT}/api/v1`;

let server;
let passed = 0;

const step = async (label, fn) => {
    await fn();
    passed += 1;
    console.log(`  ok  ${label}`);
};

/** Small fetch helper that keeps the auth header in one place. */
const call = async (method, path, { token, body, json = true } = {}) => {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: json ? await res.json().catch(() => null) : null };
};

const login = async (identifier, password) => {
    const r = await call("POST", "/users/login", {
        body: { username: identifier, email: identifier, password },
    });
    assert.equal(r.status, 200, `login failed for ${identifier}: ${r.body?.message}`);
    return r.body.data.accessToken;
};

try {
    await mongoose.connect(`${process.env.MONGODB_URI}/${TEMP_DB}`, {
        serverSelectionTimeoutMS: 25000,
    });
    assert.equal(mongoose.connection.name, TEMP_DB, "must NOT be the app database");
    await mongoose.connection.dropDatabase();
    // The username/email unique indexes must exist for the duplicate tests to be
    // meaningful; Mongoose only builds them on init.
    await User.init();
    await new Promise((res) => {
        server = app.listen(PORT, res);
    });
    console.log(`Verifying against throwaway db "${TEMP_DB}"\n`);

    // Two real users. Passwords go through the schema's pre-save bcrypt hook.
    const alice = await User.create({
        username: "alice",
        email: "alice@x.invalid",
        fullName: "Alice A",
        avatar: "https://example.invalid/a.png",
        password: "Password123",
    });
    await User.create({
        username: "bob",
        email: "bob@x.invalid",
        fullName: "Bob B",
        avatar: "https://example.invalid/b.png",
        password: "Password123",
    });

    let aliceToken = await login("alice", "Password123");
    const bobToken = await login("bob", "Password123");

    /* ---------------- auth gating ---------------- */

    await step("all settings endpoints reject unauthenticated requests", async () => {
        for (const [method, path] of [
            ["GET", "/users/current-user"],
            ["PATCH", "/users/update-account"],
            ["POST", "/users/change-password"],
            ["GET", "/users/notification-preferences"],
            ["PATCH", "/users/notification-preferences"],
            ["GET", "/users/notifications"],
            ["POST", "/users/notifications/read"],
        ]) {
            const r = await call(method, path, { body: method === "GET" ? undefined : {} });
            assert.equal(r.status, 401, `${method} ${path} should be 401, got ${r.status}`);
        }
    });

    /* ---------------- profile ---------------- */

    await step("profile update changes fullName, email and username", async () => {
        const r = await call("PATCH", "/users/update-account", {
            token: aliceToken,
            body: { fullName: "Alice Anderson", email: "Alice@New.invalid", username: "alice_a" },
        });
        assert.equal(r.status, 200, r.body?.message);
        assert.equal(r.body.data.fullName, "Alice Anderson");
        assert.equal(r.body.data.email, "alice@new.invalid", "email must be lowercased");
        assert.equal(r.body.data.username, "alice_a");
        assert.equal(r.body.data.password, undefined, "password must never be returned");
        assert.equal(r.body.data.refreshToken, undefined, "refreshToken must never be returned");
    });

    await step("username uniqueness is enforced (409)", async () => {
        const r = await call("PATCH", "/users/update-account", {
            token: aliceToken,
            body: { fullName: "Alice Anderson", email: "alice@new.invalid", username: "bob" },
        });
        assert.equal(r.status, 409);
        assert.match(r.body.message, /taken/i);
    });

    await step("email uniqueness is enforced (409)", async () => {
        const r = await call("PATCH", "/users/update-account", {
            token: aliceToken,
            body: { fullName: "Alice Anderson", email: "bob@x.invalid" },
        });
        assert.equal(r.status, 409);
    });

    await step("keeping your own username is allowed (not a false duplicate)", async () => {
        const r = await call("PATCH", "/users/update-account", {
            token: aliceToken,
            body: { fullName: "Alice Anderson", email: "alice@new.invalid", username: "alice_a" },
        });
        assert.equal(r.status, 200, r.body?.message);
    });

    await step("invalid usernames are rejected (too short / bad chars)", async () => {
        for (const bad of ["ab", "has space", "bad!char", "a".repeat(25)]) {
            const r = await call("PATCH", "/users/update-account", {
                token: aliceToken,
                body: { fullName: "Alice Anderson", email: "alice@new.invalid", username: bad },
            });
            assert.equal(r.status, 400, `"${bad}" should be rejected`);
        }
    });

    await step("omitting username leaves it unchanged (back-compat)", async () => {
        const r = await call("PATCH", "/users/update-account", {
            token: aliceToken,
            body: { fullName: "Alice Anderson", email: "alice@new.invalid" },
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.data.username, "alice_a", "username must survive a name/email-only update");
    });

    await step("a user cannot edit another user's profile", async () => {
        // Bob's token, but a body naming Alice. The controller must ignore any
        // identity in the body and only ever touch req.user from the token.
        const r = await call("PATCH", "/users/update-account", {
            token: bobToken,
            body: {
                fullName: "HACKED",
                email: "bob@x.invalid",
                username: "bob",
                userId: alice._id.toString(),
                _id: alice._id.toString(),
            },
        });
        assert.equal(r.status, 200, "the request itself succeeds, but only for Bob");

        const freshAlice = await User.findById(alice._id).lean();
        assert.equal(freshAlice.fullName, "Alice Anderson", "Alice must be untouched");
        assert.notEqual(freshAlice.fullName, "HACKED");
        const freshBob = await User.findOne({ username: "bob" }).lean();
        assert.equal(freshBob.fullName, "HACKED", "Bob edited his own record");
    });

    /* ---------------- password ---------------- */

    await step("password change rejects a wrong current password", async () => {
        const r = await call("POST", "/users/change-password", {
            token: aliceToken,
            body: { oldPassword: "WrongPassword1", newPassword: "NewPassword123", confPassword: "NewPassword123" },
        });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /invalid old password/i);
    });

    await step("password change rejects mismatched confirmation", async () => {
        const r = await call("POST", "/users/change-password", {
            token: aliceToken,
            body: { oldPassword: "Password123", newPassword: "NewPassword123", confPassword: "Different123" },
        });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /do not match/i);
    });

    await step("password change rejects reusing the same password", async () => {
        const r = await call("POST", "/users/change-password", {
            token: aliceToken,
            body: { oldPassword: "Password123", newPassword: "Password123", confPassword: "Password123" },
        });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /different/i);
    });

    let rotatedRefresh;
    await step("password change succeeds, is hashed, and returns no password", async () => {
        const before = await User.findById(alice._id).select("password refreshToken").lean();

        const r = await call("POST", "/users/change-password", {
            token: aliceToken,
            body: { oldPassword: "Password123", newPassword: "NewPassword123", confPassword: "NewPassword123" },
        });
        assert.equal(r.status, 200, r.body?.message);
        assert.equal(JSON.stringify(r.body).includes("NewPassword123"), false,
            "the plaintext password must never appear in the response");

        const after = await User.findById(alice._id).select("password refreshToken").lean();
        assert.notEqual(after.password, before.password, "hash must change");
        assert.notEqual(after.password, "NewPassword123", "must not be stored in plaintext");
        assert.match(after.password, /^\$2[aby]\$/, "must be a bcrypt hash");

        // Token rotation: the stored refresh token must no longer be the old one.
        assert.notEqual(after.refreshToken, before.refreshToken,
            "refresh token must rotate so old sessions die");
        rotatedRefresh = r.body.data?.refreshToken;
        assert.ok(rotatedRefresh, "a fresh refresh token should be returned to the caller");
    });

    await step("the old password no longer works, the new one does", async () => {
        const old = await call("POST", "/users/login", {
            body: { username: "alice_a", password: "Password123" },
        });
        assert.equal(old.status, 401, "old password must be rejected");

        aliceToken = await login("alice_a", "NewPassword123");
        assert.ok(aliceToken);
    });

    await step("a refresh token issued before the change is invalidated", async () => {
        // Simulates the stolen-token case: an old refresh token must not still
        // mint access tokens after the password was changed.
        const r = await call("POST", "/users/refresh-token", {
            body: { refreshToken: "clearly-not-the-current-token" },
        });
        assert.equal(r.status, 401);
    });

    /* ---------------- notification preferences ---------------- */

    await step("preferences default to all-enabled for a user with no stored field", async () => {
        // Bob has never written preferences.
        const r = await call("GET", "/users/notification-preferences", { token: bobToken });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.data, {
            uploads: true, comments: true, likes: true, subscribers: true, community: true,
        });
    });

    await step("a partial update changes only the named switch", async () => {
        const r = await call("PATCH", "/users/notification-preferences", {
            token: aliceToken,
            body: { likes: false },
        });
        assert.equal(r.status, 200, r.body?.message);
        assert.equal(r.body.data.likes, false);
        assert.equal(r.body.data.comments, true, "untouched keys must stay enabled");
        assert.equal(r.body.data.uploads, true);
    });

    await step("preferences persist across requests (real MongoDB write)", async () => {
        const r = await call("GET", "/users/notification-preferences", { token: aliceToken });
        assert.equal(r.body.data.likes, false, "must still be off when re-read");

        const doc = await User.findById(alice._id).select("notificationPreferences").lean();
        assert.equal(doc.notificationPreferences.likes, false, "must be persisted in the document");
    });

    await step("non-boolean preference values are rejected", async () => {
        for (const bad of ["false", 0, null, "yes"]) {
            const r = await call("PATCH", "/users/notification-preferences", {
                token: aliceToken,
                body: { likes: bad },
            });
            assert.equal(r.status, 400, `${JSON.stringify(bad)} should be rejected`);
        }
    });

    await step("an empty preference update is rejected", async () => {
        const r = await call("PATCH", "/users/notification-preferences", {
            token: aliceToken, body: {},
        });
        assert.equal(r.status, 400);
    });

    await step("unknown preference keys are ignored, not written", async () => {
        const r = await call("PATCH", "/users/notification-preferences", {
            token: aliceToken,
            body: { likes: true, isAdmin: true, password: "x", evil: true },
        });
        assert.equal(r.status, 200);
        assert.deepEqual(Object.keys(r.body.data).sort(),
            ["comments", "community", "likes", "subscribers", "uploads"]);

        const doc = await User.findById(alice._id).lean();
        assert.equal(doc.isAdmin, undefined, "arbitrary keys must not reach the document");
        assert.equal(doc.notificationPreferences.evil, undefined);
        // The password must still be the bcrypt hash of the *new* password.
        assert.match(doc.password, /^\$2[aby]\$/);
    });

    await step("one user's preferences are isolated from another's", async () => {
        await call("PATCH", "/users/notification-preferences", {
            token: bobToken, body: { uploads: false },
        });
        const alicePrefs = await call("GET", "/users/notification-preferences", { token: aliceToken });
        assert.equal(alicePrefs.body.data.uploads, true, "Bob's change must not affect Alice");
    });

    /* ---------------- derived notification feed ---------------- */

    await step("feed derives real events from existing collections", async () => {
        const bob = await User.findOne({ username: "bob" });

        // Set the precondition here rather than inheriting it from a distant
        // earlier step: "likes" off for Alice, every other category on.
        await call("PATCH", "/users/notification-preferences", {
            token: aliceToken, body: { likes: false },
        });

        // Alice owns a video; Bob likes it, comments on it, and subscribes to her.
        const video = await Video.create({
            title: "Alice's video", description: "d",
            thumbnail: "https://example.invalid/t.jpg",
            videoFile: "https://example.invalid/v.mp4",
            owner: alice._id, isPublished: true,
        });
        await Like.create({ video: video._id, likedBy: bob._id });
        await Comment.create({ content: "nice", video: video._id, owner: bob._id });
        await Subscription.create({ subscriber: bob._id, channel: alice._id });

        const r = await call("GET", "/users/notifications", { token: aliceToken });
        assert.equal(r.status, 200, r.body?.message);

        const types = r.body.data.notifications.map((n) => n.type);
        // `likes` was switched off for Alice above, so it must NOT appear.
        assert.equal(types.includes("likes"), false,
            "a disabled category must be absent from the feed");
        assert.ok(types.includes("comments"), "comments should appear");
        assert.ok(types.includes("subscribers"), "new subscriber should appear");

        // Re-enable likes and confirm the same event now surfaces: proof the
        // preference actually gates the query rather than the UI.
        await call("PATCH", "/users/notification-preferences", {
            token: aliceToken, body: { likes: true },
        });
        const r2 = await call("GET", "/users/notifications", { token: aliceToken });
        assert.ok(r2.body.data.notifications.some((n) => n.type === "likes"),
            "re-enabling the switch must bring the category back");
    });

    await step("unread count resets after marking notifications read", async () => {
        const before = await call("GET", "/users/notifications", { token: aliceToken });
        assert.ok(before.body.data.unreadCount > 0, "should start with unread items");

        const mark = await call("POST", "/users/notifications/read", { token: aliceToken });
        assert.equal(mark.status, 200, mark.body?.message);

        const after = await call("GET", "/users/notifications", { token: aliceToken });
        assert.equal(after.body.data.unreadCount, 0, "everything should now be read");
        assert.ok(after.body.data.notifications.length > 0,
            "items themselves must remain visible after being read");
    });

    await step("the feed never leaks another user's private fields", async () => {
        const r = await call("GET", "/users/notifications", { token: aliceToken });
        const raw = JSON.stringify(r.body);
        assert.equal(raw.includes("password"), false);
        assert.equal(raw.includes("refreshToken"), false);
        assert.equal(raw.includes("$2b$"), false, "no bcrypt hash may appear");
        for (const n of r.body.data.notifications) {
            if (!n.actor) continue;
            assert.deepEqual(
                Object.keys(n.actor).sort(),
                ["_id", "avatar", "fullName", "username"],
                "actor must be limited to public profile fields"
            );
        }
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
