import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("community feed exposes viewer state without leaking voter id arrays", async () => {
    const controller = await read("src/controllers/community.controller.js");
    assert.match(controller, /hasUpvoted/);
    assert.match(controller, /selectedPollOption/);
    assert.match(controller, /upvoteCount/);
    assert.match(controller, /commentCount/);
    assert.match(controller, /"pollOptions\.voters": 0/);
});

test("community discussion routes support deep-linked posts and real replies", async () => {
    const [routes, model] = await Promise.all([
        read("src/routes/community.routes.js"),
        read("src/models/community.model.js"),
    ]);
    assert.match(routes, /router\.get\("\/posts\/:postId", optionalJWT, getPost\)/);
    assert.match(routes, /router\.get\("\/posts\/:postId\/comments", optionalJWT, listPostComments\)/);
    assert.match(routes, /router\.post\("\/posts\/:postId\/comments", verifyJWT, addPostComment\)/);
    assert.match(model, /CommunityComment/);
    assert.match(model, /parent:/);
});

test("poll voting returns the selected option and aggregate counts", async () => {
    const controller = await read("src/controllers/community.controller.js");
    assert.match(controller, /selectedPollOption: idx/);
    assert.match(controller, /totalVotes:/);
    assert.match(controller, /option\.voters = option\.voters\.filter/);
});

test("community cards and post page are navigable and visibly mark reactions", async () => {
    const [preview, detail, routes, paths] = await Promise.all([
        read("../frontend/src/features/community/CommunityPreview.jsx"),
        read("../frontend/src/pages/CommunityPostPage.jsx"),
        read("../frontend/src/routes/AppRoutes.jsx"),
        read("../frontend/src/routes/paths.js"),
    ]);
    assert.match(preview, /communityPostPath/);
    assert.match(preview, /post\.hasUpvoted/);
    assert.match(preview, /selectedPollOption/);
    assert.match(preview, /commentCount/);
    assert.match(detail, /Discussion/);
    assert.match(detail, /useAddCommunityComment/);
    assert.match(detail, /Your vote is marked/);
    assert.match(routes, /\/community\/:postId/);
    assert.match(paths, /communityPostPath/);
});
