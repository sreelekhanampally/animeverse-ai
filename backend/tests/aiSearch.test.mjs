import test from "node:test";
import assert from "node:assert/strict";
import {
    normalizeSearchText,
    tokenizeSearchText,
    lexicalMatchScore,
    combineRetrievalScores,
    compareRankedResults,
} from "../src/utils/semanticRanking.js";

const narutoAnime = {
    title: {
        display: "Naruto: Shippuden",
        english: "Naruto Shippuden",
        romaji: "Naruto: Shippuuden",
    },
    genres: ["Action", "Adventure"],
    studios: ["Studio Pierrot"],
    characters: [{ name: "Naruto Uzumaki" }, { name: "Pain" }],
};

const narutoVideo = {
    _id: "v1",
    title: "Naruto vs Pain Official Clip",
    description: "Naruto confronts Pain in Konoha.",
    tags: ["naruto", "pain", "fight"],
    category: "ClipCompilation",
};

test("normalization is case/spacing/punctuation stable", () => {
    assert.equal(normalizeSearchText("  NARUTO:   Shippuden!! "), "naruto shippuden");
});

test("tokenizer keeps useful unicode/alphanumeric tokens", () => {
    assert.deepEqual(tokenizeSearchText("Gojo Satoru 2 vs Sukuna"), ["gojo", "satoru", "sukuna"]);
});

test("explicit anime title + character query receives a strong lexical signal", () => {
    const score = lexicalMatchScore("Naruto fighting Pain", narutoVideo, narutoAnime);
    assert.ok(score >= 0.45, `expected strong lexical signal, got ${score}`);
});

test("unrelated text receives little or no lexical boost", () => {
    const score = lexicalMatchScore("romantic cooking school", narutoVideo, narutoAnime);
    assert.ok(score <= 0.15, `expected weak lexical signal, got ${score}`);
});

test("score blending keeps lexical boost secondary to semantic retrieval", () => {
    const semanticHeavy = combineRetrievalScores({
        videoSemantic: 0.7,
        animeSemantic: 0.6,
        lexical: 0,
    });
    const lexicalOnly = combineRetrievalScores({
        videoSemantic: 0,
        animeSemantic: 0,
        lexical: 1,
    });
    assert.ok(semanticHeavy > lexicalOnly);
});

test("negative cosine values do not create negative ranked scores", () => {
    assert.equal(
        combineRetrievalScores({ videoSemantic: -0.4, animeSemantic: -0.2, lexical: 0 }),
        0
    );
});

test("there is no hard similarity floor: low valid semantic matches retain a score", () => {
    const score = combineRetrievalScores({
        videoSemantic: 0.12,
        animeSemantic: 0.19,
        lexical: 0,
    });
    assert.ok(score > 0 && score < 0.3);
});

test("rank comparator is deterministic and sorts descending", () => {
    const rows = [
        { score: 0.4, lexicalScore: 0.1, semanticScore: 0.4, video: { _id: "b" } },
        { score: 0.7, lexicalScore: 0, semanticScore: 0.7, video: { _id: "c" } },
        { score: 0.4, lexicalScore: 0.3, semanticScore: 0.2, video: { _id: "a" } },
    ];
    rows.sort(compareRankedResults);
    assert.deepEqual(rows.map((row) => row.video._id), ["c", "a", "b"]);
});
