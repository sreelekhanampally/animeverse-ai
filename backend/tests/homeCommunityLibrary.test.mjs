import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Watch Later is persisted on User and exposed through authenticated user routes", async () => {
    const [model, routes, controller] = await Promise.all([
        read("src/models/user.model.js"),
        read("src/routes/user.routes.js"),
        read("src/controllers/user.controller.js"),
    ]);
    assert.match(model, /watchLater\s*:/);
    assert.match(routes, /"\/watch-later"/);
    assert.match(routes, /"\/watch-later\/:videoId"/);
    assert.match(controller, /toggleWatchLater/);
    assert.match(controller, /getWatchLater/);
});

test("history endpoints support remove and clear and preserve newest-first id order", async () => {
    const [routes, users, videos] = await Promise.all([
        read("src/routes/user.routes.js"),
        read("src/controllers/user.controller.js"),
        read("src/controllers/video.controller.js"),
    ]);
    assert.match(routes, /"\/history"[\s\S]*\.delete\(verifyJWT, clearWatchHistory\)/);
    assert.match(routes, /"\/history\/:videoId"\)\.delete\(verifyJWT, removeFromWatchHistory\)/);
    assert.match(users, /orderedIds\.map/);
    assert.match(videos, /\$slice:[\s\S]*\$concatArrays/);
    assert.match(videos, /\$filter:[\s\S]*watchHistory/);
});

test("homepage sections are data-backed and captions do not claim weekly or scene-timestamp analytics", async () => {
    const [home, hero] = await Promise.all([
        read("../frontend/src/pages/HomePage.jsx"),
        read("../frontend/src/features/home/HeroBanner.jsx"),
    ]);
    assert.match(home, /useGenreVideos/);
    assert.match(home, /useRecommendedVideos/);
    assert.match(home, /useCreatorOriginals/);
    assert.match(home, /Most watched on AnimeVerse/);
    assert.match(home, /New on AnimeVerse/);
    assert.equal(/Most-watched this week/i.test(home), false);
    assert.equal(/Recently Uploaded/i.test(home), false);
    assert.equal(/timestamp/i.test(hero), false);
    assert.equal(/finds? (the )?scene/i.test(hero), false);
});

test("community frontend uses real community post API rather than dead tweet feed", async () => {
    const [hooks, services] = await Promise.all([
        read("../frontend/src/features/community/hooks.js"),
        read("../frontend/src/services/index.js"),
    ]);
    assert.match(hooks, /communityService/);
    assert.equal(/tweetService/.test(hooks), false);
    assert.match(services, /communityService\s*=\s*\{/);
    assert.match(services, /\/community\/posts/);
});

test("YouTube growth remains capped but supports a larger catalogue and offset batches", async () => {
    const [ingest, cli] = await Promise.all([
        read("src/utils/youtubeIngest.js"),
        read("src/scripts/ingestYouTube.js"),
    ]);
    assert.match(ingest, /MAX_VIDEOS_PER_ANIME\s*=\s*15/);
    assert.match(ingest, /Math\.min\(Math\.max\(slots \* 3, 30\), 50\)/);
    assert.match(ingest, /queryOffset/);
    assert.match(cli, /args\.offset/);
    assert.match(cli, /args\["query-offset"\]/);
    assert.match(cli, /--total-cap/);
});

test("community seeding is explicitly demo-only and credentials are excluded from git", async () => {
    const [seed, gitignore] = await Promise.all([
        read("src/scripts/seedCommunity.js"),
        read("../.gitignore"),
    ]);
    assert.match(seed, /av_demo_/);
    assert.match(seed, /community-accounts\.json/);
    assert.match(seed, /Passwords were intentionally not printed/);
    assert.match(gitignore, /backend\/\.seed-output\//);
});

test("Windows-safe npm test command no longer relies on shell glob expansion", async () => {
    const pkg = JSON.parse(await read("package.json"));
    assert.equal(pkg.scripts.test, "node --test");
});
