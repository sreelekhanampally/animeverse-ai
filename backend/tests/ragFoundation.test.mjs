import test from "node:test";
import assert from "node:assert/strict";

import {
    buildAnimeRagChunks,
    buildVideoRagChunks,
    chunkText,
    RAG_INDEX_VERSION,
} from "../src/utils/ragChunking.js";
import { fuseRankings, rerankRagResults } from "../src/utils/ragRanking.js";
import { buildRagContext } from "../src/services/ragRetrieval.service.js";

const oid = (value) => ({
    toString: () => value,
});

test("chunkText keeps long knowledge in bounded overlapping chunks", () => {
    const text = Array.from(
        { length: 40 },
        (_, index) => `Sentence ${index + 1} explains an anime plot detail with enough words to make chunking useful.`
    ).join(" ");

    const chunks = chunkText(text, { maxChars: 220, overlapChars: 40 });
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every((chunk) => chunk.length <= 220));
    assert.match(chunks[0], /Sentence 1/);
});

test("anime indexing creates separate identity and synopsis retrieval units", () => {
    const anime = {
        _id: oid("anime-1"),
        title: {
            display: "Fullmetal Alchemist: Brotherhood",
            english: "Fullmetal Alchemist: Brotherhood",
            native: "鋼の錬金術師",
        },
        genres: ["Action", "Adventure"],
        studios: ["Bones"],
        characters: [{ name: "Edward Elric", role: "MAIN" }],
        description:
            "Two brothers search for the Philosopher's Stone after a forbidden alchemy experiment costs them their bodies.",
        metadataSource: "anilist",
    };

    const chunks = buildAnimeRagChunks(anime);
    assert.equal(chunks[0].sourceType, "anime_metadata");
    assert.ok(chunks.some((chunk) => chunk.sourceType === "anime_synopsis"));
    assert.ok(chunks.every((chunk) => chunk.indexVersion === RAG_INDEX_VERSION));
    assert.match(chunks[0].content, /Edward Elric/);
});

test("YouTube metadata never turns a stored transcript into a RAG transcript chunk", () => {
    const video = {
        _id: oid("video-yt"),
        isPublished: true,
        sourceType: "youtube",
        title: "Official Trailer",
        description: "Official promotional video",
        transcript: "This value must never become a YouTube transcript chunk.",
        tags: [],
    };

    const chunks = buildVideoRagChunks(video);
    assert.equal(chunks.filter((chunk) => chunk.sourceType === "creator_transcript").length, 0);
    assert.equal(chunks.filter((chunk) => chunk.sourceType === "video_metadata").length, 1);
});

test("creator-uploaded stored transcripts are chunked for RAG", () => {
    const video = {
        _id: oid("video-cloud"),
        isPublished: true,
        sourceType: "cloudinary",
        title: "Creator review",
        description: "A creator-uploaded review.",
        transcript: Array.from(
            { length: 30 },
            (_, index) => `Transcript sentence ${index + 1} discusses character motivation and story themes.`
        ).join(" "),
        tags: ["review"],
        transcriptLang: "en",
    };

    const chunks = buildVideoRagChunks(video);
    assert.ok(chunks.some((chunk) => chunk.sourceType === "creator_transcript"));
});

test("hybrid fusion keeps vector and lexical rank provenance", () => {
    const a = { _id: "a", title: "Alchemy brothers", content: "alchemy brothers restore bodies" };
    const b = { _id: "b", title: "Pirate crew", content: "pirates search for treasure" };

    const fused = fuseRankings(
        [
            { chunk: a, semanticScore: 0.81 },
            { chunk: b, semanticScore: 0.72 },
        ],
        [
            { chunk: b, mongoTextScore: 5 },
            { chunk: a, mongoTextScore: 3 },
        ]
    );

    const ranked = rerankRagResults("alchemy brothers", fused);
    const first = ranked.find((row) => row.chunk._id === "a");
    assert.equal(first.vectorRank, 1);
    assert.equal(first.lexicalRank, 2);
    assert.ok(first.score > 0);
});

test("context builder preserves citations and prevents one source from monopolizing context", () => {
    const results = [
        { citationId: "AV1", sourceType: "anime_synopsis", sourceId: "a", title: "A 1", excerpt: "one" },
        { citationId: "AV2", sourceType: "anime_synopsis", sourceId: "a", title: "A 2", excerpt: "two" },
        { citationId: "AV3", sourceType: "anime_synopsis", sourceId: "a", title: "A 3", excerpt: "three" },
        { citationId: "AV4", sourceType: "video_metadata", sourceId: "b", title: "B", excerpt: "four" },
    ];

    const context = buildRagContext(results, { maxChars: 5000, maxPerSource: 2 });
    assert.match(context, /\[AV1\]/);
    assert.match(context, /\[AV2\]/);
    assert.doesNotMatch(context, /\[AV3\]/);
    assert.match(context, /\[AV4\]/);
});
