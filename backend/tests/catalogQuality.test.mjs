import test from "node:test";
import assert from "node:assert/strict";

import {
    classifyVideoKind,
    selectDiverseCandidates,
} from "../src/utils/youtubeIngest.js";
import {
    animeMetadataCompleteness,
    buildCoverageSummary,
    buildQualityFirstOrder,
    detectDuplicateTitleGroups,
    isSafeToQuarantineReason,
    structuralIssuesForVideo,
} from "../src/services/catalogQuality.service.js";

const anime = (id, title, popularity = 0, metadataSource = "anilist") => ({
    _id: id,
    title: { display: title },
    popularity,
    metadataSource,
});

const video = (overrides = {}) => ({
    _id: overrides._id || `v-${Math.random()}`,
    sourceType: "youtube",
    externalVideoId: "aBcDeFgHiJk",
    anime: overrides.anime || { _id: "a1" },
    title: "Example Official Trailer",
    thumbnail: "https://i.ytimg.com/example.jpg",
    description: "Official trailer",
    duration: 120,
    isPublished: true,
    ...overrides,
});

test("content kind classifier separates the catalogue into useful discovery types", () => {
    assert.equal(classifyVideoKind("Demon Slayer Official Trailer"), "trailer");
    assert.equal(classifyVideoKind("JUJUTSU KAISEN Opening 2"), "opening");
    assert.equal(classifyVideoKind("Frieren Ending Theme"), "ending");
    assert.equal(classifyVideoKind("Attack on Titan Official Clip"), "clip");
    assert.equal(classifyVideoKind("ONE PIECE PV"), "promo");
});

test("diversity selection prefers a mixed batch before same-kind extras", () => {
    const entries = [
        { video: { title: "A trailer" }, verdict: { score: 9, trustedChannel: true } },
        { video: { title: "B trailer" }, verdict: { score: 7, trustedChannel: true } },
        { video: { title: "C trailer" }, verdict: { score: 7, trustedChannel: true } },
        { video: { title: "Opening 1" }, verdict: { score: 6, trustedChannel: true } },
        { video: { title: "Official Clip" }, verdict: { score: 6, trustedChannel: true } },
    ];

    const { selected } = selectDiverseCandidates(entries, 4, { maxKindShare: 0.5 });
    assert.equal(selected.length, 4);
    assert.ok(selected.some((entry) => entry.kind === "opening"));
    assert.ok(selected.some((entry) => entry.kind === "clip"));
    assert.ok(selected.filter((entry) => entry.kind === "trailer").length <= 2);
});

test("diversity cap is soft for exceptional trusted results", () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({
        video: { title: `Official Trailer ${index + 1}` },
        verdict: { score: 10, trustedChannel: true },
    }));
    const { selected } = selectDiverseCandidates(entries, 3, { maxKindShare: 0.5 });
    assert.equal(selected.length, 3, "strong official videos may fill a real coverage gap");
});

test("structural audit catches broken persisted YouTube rows", () => {
    const issues = structuralIssuesForVideo(
        video({ externalVideoId: "bad", anime: null, thumbnail: "", duration: 0, description: "" })
    );
    assert.ok(issues.includes("invalid YouTube id"));
    assert.ok(issues.includes("missing anime link"));
    assert.ok(issues.includes("missing thumbnail"));
    assert.ok(issues.includes("invalid duration"));
    assert.ok(issues.includes("missing description"));
});

test("duplicate audit is scoped per anime and keeps different anime independent", () => {
    const rows = [
        video({ _id: "v1", anime: { _id: "a1" }, title: "Death Note Official Trailer [HD]" }),
        video({ _id: "v2", anime: { _id: "a1" }, title: "Death Note Official Trailer" }),
        video({ _id: "v3", anime: { _id: "a2" }, title: "Death Note Official Trailer" }),
    ];
    const groups = detectDuplicateTitleGroups(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].animeId, "a1");
});

test("coverage audit finds empty, undercovered, over-ceiling and concentrated anime", () => {
    const animeDocs = [anime("a1", "A"), anime("a2", "B"), anime("a3", "C"), anime("a4", "D")];
    const videos = [
        video({ _id: "a1v1", anime: { _id: "a1" }, title: "A Trailer" }),
        video({ _id: "a1v2", anime: { _id: "a1" }, title: "A Opening" }),
        ...Array.from({ length: 5 }, (_, i) => video({ _id: `a3v${i}`, anime: { _id: "a3" }, title: `A3 Trailer ${i}` })),
        ...Array.from({ length: 16 }, (_, i) => video({ _id: `a4v${i}`, anime: { _id: "a4" }, title: `A4 Clip ${i}` })),
    ];
    const result = buildCoverageSummary(animeDocs, videos);
    assert.deepEqual(result.zero.map((row) => row.animeId), ["a2"]);
    assert.deepEqual(result.undercovered.map((row) => row.animeId), ["a1"]);
    assert.deepEqual(result.overCeiling.map((row) => row.animeId), ["a4"]);
    assert.ok(result.concentrated.some((row) => row.animeId === "a3"));
});

test("quality-first order spends quota on undercovered anime before popular full ones", () => {
    const docs = [anime("full", "Popular", 1000), anime("empty", "Gap", 100), anime("one", "One", 900)];
    const counts = new Map([["full", 12], ["empty", 0], ["one", 1]]);
    const ordered = buildQualityFirstOrder(docs, counts);
    assert.deepEqual(ordered.map((row) => row._id), ["empty", "one", "full"]);
});

test("metadata completeness reports sparse curated rows honestly", () => {
    const sparse = animeMetadataCompleteness({
        title: { display: "Monster" },
        metadataSource: "curated",
        genres: [],
        studios: [],
        description: "",
        coverImage: {},
        startYear: null,
    });
    assert.equal(sparse.checks.title, true);
    assert.equal(sparse.percent, 17);

    const rich = animeMetadataCompleteness({
        title: { display: "Monster" },
        description: "A psychological thriller",
        genres: ["Drama"],
        coverImage: { large: "cover.jpg" },
        studios: ["Madhouse"],
        startYear: 2004,
    });
    assert.equal(rich.percent, 100);
});

test("quarantine policy is conservative: hard invalids yes, relevance heuristics no", () => {
    assert.equal(isSafeToQuarantineReason("not embeddable"), true);
    assert.equal(isSafeToQuarantineReason("fabricated/fan content (concept trailer)"), true);
    assert.equal(isSafeToQuarantineReason("anime entity mismatch: video title does not strongly identify Naruto"), false);
    assert.equal(isSafeToQuarantineReason("anime entity collision: The Gray Man conflicts with D.Gray-man"), true);
    assert.equal(isSafeToQuarantineReason("quality score 2 < 3"), false);
});
