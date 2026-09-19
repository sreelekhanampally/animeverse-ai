import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    combineSimilarityScore,
    explainSearchMatch,
    explainSimilarityMatch,
    overlapRatio,
    sharedValues,
} from "../src/utils/discoveryExplain.js";

const sourceVideo = {
    _id: "source",
    title: "Cyberpunk: Edgerunners Official Trailer",
    tags: ["cyberpunk", "dystopian", "action"],
    category: "Trailer",
    anime: {
        _id: "anime-a",
        genres: ["Action", "Sci-Fi"],
    },
};

const candidateVideo = {
    _id: "candidate",
    title: "Psycho-Pass Official Trailer",
    tags: ["dystopian", "police"],
    category: "Trailer",
    anime: {
        _id: "anime-b",
        genres: ["Action", "Sci-Fi", "Psychological"],
    },
};

test("discovery overlap helpers are deterministic and normalized", () => {
    assert.deepEqual(sharedValues(["Action", "SCI-FI"], ["action", "Sci-Fi", "Drama"]), ["action", "sci fi"]);
    assert.ok(Math.abs(overlapRatio(["Action", "Sci-Fi"], ["action", "Sci-Fi", "Drama"]) - 2 / 3) < 1e-6);
});

test("semantic similarity remains the dominant signal", () => {
    const highSemantic = combineSimilarityScore({ semantic: 0.8, sameAnime: 0, genreOverlap: 0, metadataOverlap: 0 });
    const weakSemanticSameAnime = combineSimilarityScore({ semantic: 0.2, sameAnime: 1, genreOverlap: 1, metadataOverlap: 1 });
    assert.ok(highSemantic > weakSemanticSameAnime, "metadata boosts must not overwhelm embeddings");
});

test("similarity explanation exposes human-readable reasons without pretending scene knowledge", () => {
    const reasons = explainSimilarityMatch(sourceVideo, candidateVideo, 0.61);
    assert.ok(reasons.some((reason) => /Shared genre/i.test(reason)));
    assert.ok(reasons.some((reason) => /similar theme|related theme|close overall match/i.test(reason)));
    assert.ok(reasons.every((reason) => !/scene|timestamp|watched/i.test(reason)));
});

test("search explanation identifies title/character/genre signals", () => {
    const result = {
        video: {
            title: "Gojo Satoru Official Character Trailer",
            anime: {
                title: { display: "Jujutsu Kaisen" },
                genres: ["Action", "Supernatural"],
                characters: [{ name: "Satoru Gojo" }],
            },
        },
        semanticScore: 0.52,
        animeScore: 0.49,
        score: 0.58,
    };
    const reasons = explainSearchMatch("Gojo supernatural", result);
    assert.ok(reasons.some((reason) => /character|title/i.test(reason)));
    assert.ok(reasons.some((reason) => /genre/i.test(reason)));
});

test("AI routes expose similar videos, discovery graph and dynamic collections", async () => {
    const source = await readFile(new URL("../src/routes/ai.routes.js", import.meta.url), "utf8");
    assert.match(source, /videos\/:videoId\/similar/);
    assert.match(source, /videos\/:videoId\/graph/);
    assert.match(source, /post\("\/collections"/);
});

test("recommendations combine history, likes and watch-later signals", async () => {
    const source = await readFile(new URL("../src/controllers/ai.controller.js", import.meta.url), "utf8");
    assert.match(source, /watchHistory watchLater/);
    assert.match(source, /Like\.find/);
    assert.match(source, /Similar to videos you liked/);
    assert.match(source, /Similar to videos you saved/);
    assert.match(source, /Similar to videos you watched/);
});

test("frontend wires Discovery Lab, similarity map and explainable cards", async () => {
    const [routes, sidebar, watchPage, discoveryPage] = await Promise.all([
        readFile(new URL("../../frontend/src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
        readFile(new URL("../../frontend/src/layouts/Sidebar.jsx", import.meta.url), "utf8"),
        readFile(new URL("../../frontend/src/pages/WatchPage.jsx", import.meta.url), "utf8"),
        readFile(new URL("../../frontend/src/pages/DiscoveryPage.jsx", import.meta.url), "utf8"),
    ]);
    assert.match(routes, /DiscoveryPage/);
    assert.match(sidebar, /Discovery Lab/);
    assert.match(watchPage, /More like this/);
    assert.match(watchPage, /Related video map/);
    assert.match(discoveryPage, /Why this\?/);
    assert.match(discoveryPage, /Explore related videos/);
});
