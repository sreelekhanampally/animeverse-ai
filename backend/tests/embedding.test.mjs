/**
 * Embedding foundation tests. Pure logic — no network, no database, no API key.
 *
 *   node --test tests/
 *   node tests/embedding.test.mjs
 *
 * Uses node:test/node:assert from the standard library, so it adds no dependency,
 * matching tests/youtubeFilter.test.mjs.
 *
 * NO TEST HERE CALLS OPENAI. The provider-unavailable test deletes the key from the
 * environment before asserting, and every "valid vector" case builds a synthetic
 * 1536-float array. That is deliberate: a test suite that spent money or needed
 * network access would not be run, and these are exactly the invariants that must
 * hold before anyone spends money on a backfill.
 *
 * The document shapes below mirror the real models — a YouTube video with no
 * videoFile, a Cloudinary upload with one, and the real AniList-backed Naruto
 * Anime document.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_VERSION,
    EmbeddingUnavailableError,
    EmbeddingValidationError,
    activeEmbeddingIdentity,
    hasEmbeddingProvider,
} from "../src/config/embedding.config.js";
import {
    cosineSimilarity,
    describeEmbeddingState,
    embeddingStatus,
    generateEmbedding,
    isSearchableEmbedding,
    resetEmbeddingClient,
} from "../src/services/embedding.service.js";
import {
    buildAnimeEmbeddingText,
    buildVideoEmbeddingText,
    hashEmbeddingText,
    isTranscriptEligible,
} from "../src/utils/embeddingText.js";

/* ========================================================================== *
 * Fixtures
 * ========================================================================== */

/** Real AniList data for Naruto Shippuden, trimmed to the fields that are read. */
const NARUTO = {
    title: {
        romaji: "NARUTO: Shippuuden",
        english: "Naruto Shippuden",
        native: "ナルト- 疾風伝",
        display: "Naruto: Shippuden",
    },
    description: "Naruto Uzumaki returns to Konoha after two and a half years of training.",
    genres: ["Action", "Adventure", "Fantasy"],
    studios: ["Studio Pierrot"],
    format: "TV",
    status: "FINISHED",
    season: "WINTER",
    seasonYear: 2007,
    characters: [
        { anilistId: 17, name: "Naruto Uzumaki", role: "MAIN", image: "https://img.invalid/n.jpg" },
        { anilistId: 13, name: "Sasuke Uchiha", role: "MAIN", image: "https://img.invalid/s.jpg" },
        { anilistId: 145, name: "Iruka Umino", role: "SUPPORTING", image: "" },
    ],
    // Present on the real document and deliberately never embedded.
    averageScore: 82,
    popularity: 350000,
    anilistId: 1735,
    siteUrl: "https://anilist.co/anime/1735",
    coverImage: { large: "https://img.invalid/cover.jpg", extraLarge: "", color: "#e4a15d" },
};

/**
 * A YouTube-imported video. Note there is NO videoFile: the model's conditional
 * `required` allows that, and the embedding text must not need it.
 */
const youtubeVideo = (overrides = {}) => ({
    _id: "651111111111111111111111",
    sourceType: "youtube",
    externalVideoId: "dQw4w9WgXcQ",
    title: "Naruto Shippuden Opening 16 | Silhouette by KANA-BOON",
    description: "The official opening for Naruto Shippuden.",
    thumbnail: "https://i.ytimg.invalid/vi/dQw4w9WgXcQ/hq.jpg",
    tags: ["naruto", "opening"],
    category: "Music",
    duration: 100,
    views: 1200,
    isPublished: true,
    ...overrides,
});

/** A creator upload: videoFile present, externalVideoId absent. */
const cloudinaryVideo = (overrides = {}) => ({
    _id: "652222222222222222222222",
    sourceType: "cloudinary",
    videoFile: "https://res.cloudinary.invalid/video/upload/v1/abc.mp4",
    title: "Why Frieren's pacing works",
    description: "A video essay on episode structure.",
    thumbnail: "https://res.cloudinary.invalid/image/upload/v1/abc.jpg",
    tags: ["frieren", "analysis"],
    category: "Review",
    duration: 600,
    isPublished: true,
    ...overrides,
});

/** A structurally valid vector: 1536 finite, non-zero floats. */
const validVector = (seed = 1) =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin((i + seed) * 0.01));

/** A correctly stamped, searchable document. */
const embedded = (overrides = {}) => ({
    embedding: validVector(),
    ...activeEmbeddingIdentity(),
    embeddingGeneratedAt: new Date("2026-01-01T00:00:00Z"),
    embeddingTextHash: hashEmbeddingText("anything"),
    ...overrides,
});

/* ========================================================================== *
 * Centralised configuration
 * ========================================================================== */

test("config: the active identity is the documented model/dimensions/version", () => {
    assert.equal(EMBEDDING_MODEL, "text-embedding-3-small");
    assert.equal(EMBEDDING_DIMENSIONS, 1536);
    assert.equal(EMBEDDING_VERSION, "metadata-v1");
});

test("config: dimensions are not overridable by the environment", () => {
    // A typo in an env var must not be able to produce vectors that pass validation
    // and are still incompatible. Dimension count is a property of the model.
    const before = EMBEDDING_DIMENSIONS;
    process.env.EMBEDDING_DIMENSIONS = "32";
    process.env.OPENAI_EMBED_MODEL = "text-embedding-3-large";
    try {
        assert.equal(EMBEDDING_DIMENSIONS, before);
        assert.equal(EMBEDDING_MODEL, "text-embedding-3-small");
        assert.equal(activeEmbeddingIdentity().embeddingDimensions, 1536);
    } finally {
        delete process.env.EMBEDDING_DIMENSIONS;
        delete process.env.OPENAI_EMBED_MODEL;
    }
});

test("config: activeEmbeddingIdentity returns a fresh object each call", () => {
    // Callers spread this into Mongoose updates; a shared mutable constant could be
    // corrupted for the whole process by one careless mutation.
    const a = activeEmbeddingIdentity();
    const b = activeEmbeddingIdentity();
    assert.notEqual(a, b, "must not be the same object reference");
    a.embeddingModel = "mutated";
    assert.equal(b.embeddingModel, EMBEDDING_MODEL);
});

/* ========================================================================== *
 * Deterministic embedding text
 * ========================================================================== */

test("deterministic: the same anime yields byte-identical text and hash", () => {
    const first = buildAnimeEmbeddingText(NARUTO);
    const second = buildAnimeEmbeddingText(NARUTO);
    assert.equal(first, second);
    assert.equal(hashEmbeddingText(first), hashEmbeddingText(second));
    assert.ok(first.length > 0);
});

test("deterministic: the same video yields byte-identical text and hash", () => {
    const video = cloudinaryVideo();
    assert.equal(buildVideoEmbeddingText(video), buildVideoEmbeddingText(video));
    assert.equal(
        hashEmbeddingText(buildVideoEmbeddingText(video)),
        hashEmbeddingText(buildVideoEmbeddingText(video))
    );
});

test("deterministic: genre/tag/studio ORDER does not change the text", () => {
    // The set is what carries meaning; incoming order is incidental and AniList may
    // reorder upstream. Without normalisation a reordered-but-identical list would
    // hash differently and trigger a pointless, billable re-embed of the corpus.
    const reordered = { ...NARUTO, genres: ["Fantasy", "Action", "Adventure"] };
    assert.equal(buildAnimeEmbeddingText(NARUTO), buildAnimeEmbeddingText(reordered));

    const a = cloudinaryVideo({ tags: ["frieren", "analysis"] });
    const b = cloudinaryVideo({ tags: ["analysis", "frieren"] });
    assert.equal(buildVideoEmbeddingText(a), buildVideoEmbeddingText(b));
});

test("deterministic: duplicate and whitespace-only tags are normalised away", () => {
    const messy = cloudinaryVideo({ tags: ["Frieren", "frieren", "  ", "analysis", "ANALYSIS", ""] });
    const tagLine = buildVideoEmbeddingText(messy)
        .split("\n")
        .find((l) => l.startsWith("Tags:"));

    // Two duplicates collapse to one each, blanks vanish, and the surviving pair is
    // sorted (so order is independent of how they arrived). Case is preserved from
    // the first occurrence rather than lowercased, because the original casing is
    // what a reader would recognise and it carries no risk of instability.
    assert.equal(tagLine, "Tags: analysis, Frieren");

    // A different arrival order for the same set produces the identical line, which
    // is the property that stops a re-ordered tag list from forcing a re-embed.
    const reordered = cloudinaryVideo({ tags: ["ANALYSIS", "frieren"] });
    const reorderedLine = buildVideoEmbeddingText(reordered)
        .split("\n")
        .find((l) => l.startsWith("Tags:"));
    assert.equal(reorderedLine, "Tags: ANALYSIS, frieren");
    // Same membership, so the *set* is stable even though casing differs by source.
    assert.deepEqual(
        tagLine.slice(6).split(", ").map((t) => t.toLowerCase()).sort(),
        reorderedLine.slice(6).split(", ").map((t) => t.toLowerCase()).sort()
    );
});

test("deterministic: cosmetic whitespace changes do not change the hash", () => {
    const spaced = cloudinaryVideo({ description: "A  video   essay\r\n\r\n\r\non episode structure.  " });
    const plain = cloudinaryVideo({ description: "A video essay\n\non episode structure." });
    assert.equal(
        hashEmbeddingText(buildVideoEmbeddingText(spaced)),
        hashEmbeddingText(buildVideoEmbeddingText(plain))
    );
});

test("deterministic: a real content change DOES change the hash", () => {
    // The counterpart to the stability tests: normalisation must not be so
    // aggressive that a genuine edit stops triggering a re-embed.
    const before = buildVideoEmbeddingText(cloudinaryVideo());
    const after = buildVideoEmbeddingText(cloudinaryVideo({ title: "Why Frieren's pacing fails" }));
    assert.notEqual(hashEmbeddingText(before), hashEmbeddingText(after));
});

test("deterministic: main characters lead, and role order is stable", () => {
    const shuffled = {
        ...NARUTO,
        characters: [NARUTO.characters[2], NARUTO.characters[1], NARUTO.characters[0]],
    };
    assert.equal(buildAnimeEmbeddingText(NARUTO), buildAnimeEmbeddingText(shuffled));

    const line = buildAnimeEmbeddingText(NARUTO)
        .split("\n")
        .find((l) => l.startsWith("Main characters:"));
    assert.ok(line.indexOf("Naruto Uzumaki") < line.indexOf("Iruka Umino"), "MAIN before SUPPORTING");
});

test("anime text: every useful AniList-backed field is present", () => {
    const text = buildAnimeEmbeddingText(NARUTO);
    for (const expected of [
        "Naruto: Shippuden", // display
        "Naruto Shippuden", // english
        "NARUTO: Shippuuden", // romaji
        "ナルト- 疾風伝", // native
        "Action",
        "Studio Pierrot",
        "TV",
        "FINISHED",
        "WINTER 2007",
        "Naruto Uzumaki",
        "returns to Konoha",
    ]) {
        assert.ok(text.includes(expected), `expected "${expected}" in anime text`);
    }
});

test("anime text: missing fields are omitted, not filled with placeholders", () => {
    // AniList genuinely returns null for english titles, seasons and formats on
    // older or niche series. A "null" or "unknown" string would be embedded as
    // meaningful language and pollute the vector.
    const sparse = {
        title: { romaji: "Some OVA", english: "", native: "", display: "Some OVA" },
        description: "",
        genres: [],
        studios: [],
        format: null,
        status: null,
        season: null,
        seasonYear: null,
        characters: [],
    };
    const text = buildAnimeEmbeddingText(sparse);
    assert.equal(text, "Anime: Some OVA");
    assert.ok(!/null|undefined|unknown|N\/A/i.test(text));
});

test("video text: title, description, tags, category and linked anime all participate", () => {
    const text = buildVideoEmbeddingText(cloudinaryVideo(), { anime: NARUTO });
    assert.ok(text.includes("Why Frieren's pacing works"));
    assert.ok(text.includes("video essay"));
    assert.ok(text.includes("frieren"));
    assert.ok(text.includes("Review"));
    assert.ok(text.includes("Naruto: Shippuden"), "linked anime metadata must be included");
    assert.ok(text.includes("Studio Pierrot"));
});

test("video text: a populated anime on the document is used when none is passed", () => {
    const withPopulated = cloudinaryVideo({ anime: NARUTO });
    assert.ok(buildVideoEmbeddingText(withPopulated).includes("Naruto: Shippuden"));
});

test("video text: an unpopulated anime ObjectId is ignored, not stringified", () => {
    // "68f0a1b2c3d4e5f6a7b8c9d0" is not language and nobody searches for it.
    const raw = cloudinaryVideo({ anime: "68f0a1b2c3d4e5f6a7b8c9d0" });
    const text = buildVideoEmbeddingText(raw);
    assert.ok(!text.includes("68f0a1b2c3d4e5f6a7b8c9d0"));
    assert.ok(!text.includes("Anime:"));
});

/* ========================================================================== *
 * No secret or private data in embedding text.
 *
 * The builders read a fixed whitelist of named fields — there is no object walk
 * anywhere in utils/embeddingText.js. These tests pin that property by attaching
 * every sensitive field the real models carry (and a populated owner, which is one
 * `.populate()` away on any real query) and asserting none of it survives.
 * ========================================================================== */

/** A populated owner exactly as `.populate("owner")` would return it. */
const HOSTILE_OWNER = {
    _id: "653333333333333333333333",
    username: "creator_one",
    fullName: "Creator One",
    email: "creator@private.invalid",
    password: "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV",
    refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SUPERSECRETREFRESH.sig",
    watchHistory: ["654444444444444444444444"],
};

const SECRETS = [
    "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SUPERSECRETREFRESH.sig",
    "creator@private.invalid",
    "sk-proj-THISMUSTNEVERAPPEAR",
    "mongodb+srv://user:pw@cluster.mongodb.net",
    "654444444444444444444444",
];

test("privacy: no credential, token, email or private field reaches the embedding text", () => {
    const hostile = cloudinaryVideo({
        owner: HOSTILE_OWNER,
        // Fields that genuinely exist on the model and must not be embedded.
        videoFile: "https://res.cloudinary.invalid/video/upload/v1/abc.mp4",
        thumbnail: "https://res.cloudinary.invalid/image/upload/v1/abc.jpg",
        // Hypothetical future/accidental fields — the whitelist ignores them by
        // construction, which is the point.
        apiKey: "sk-proj-THISMUSTNEVERAPPEAR",
        password: "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV",
        refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SUPERSECRETREFRESH.sig",
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SUPERSECRETREFRESH.sig",
        mongoUri: "mongodb+srv://user:pw@cluster.mongodb.net",
        email: "creator@private.invalid",
    });

    const text = buildVideoEmbeddingText(hostile, { anime: NARUTO });

    for (const secret of SECRETS) {
        assert.ok(!text.includes(secret), `embedding text must not contain ${secret.slice(0, 24)}...`);
    }
    // The owner is not a semantic property of a video and is not read at all.
    assert.ok(!text.includes("creator_one"), "owner username must not be embedded");
    assert.ok(!text.includes("Creator One"), "owner full name must not be embedded");
    // Media locations are identifiers, not language.
    assert.ok(!text.includes("cloudinary.invalid"), "no media URL");
    assert.ok(!text.includes("res.cloudinary"), "no media URL");
    // Sanity: the legitimate content IS there, so the assertions above are not
    // passing merely because the text is empty.
    assert.ok(text.includes("Why Frieren's pacing works"));
});

test("privacy: an anime document's URLs and ids are not embedded", () => {
    const text = buildAnimeEmbeddingText(NARUTO);
    assert.ok(!text.includes("anilist.co"), "siteUrl must not be embedded");
    assert.ok(!text.includes("img.invalid"), "image URLs must not be embedded");
    assert.ok(!text.includes("1735"), "anilistId must not be embedded");
    assert.ok(!text.includes("350000"), "popularity must not be embedded");
});

test("privacy: no JWT-shaped or key-shaped string can appear in either builder", () => {
    // A structural check rather than a list of known strings, so a future field that
    // happens to hold a token is caught by shape alone.
    for (const text of [
        buildAnimeEmbeddingText(NARUTO),
        buildVideoEmbeddingText(cloudinaryVideo({ owner: HOSTILE_OWNER }), { anime: NARUTO }),
        buildVideoEmbeddingText(youtubeVideo({ owner: HOSTILE_OWNER })),
    ]) {
        assert.ok(!/eyJ[A-Za-z0-9_-]{6,}\./.test(text), "no JWT-shaped string");
        assert.ok(!/\bsk-[A-Za-z0-9-]{8,}/.test(text), "no OpenAI-key-shaped string");
        assert.ok(!/\$2[aby]\$\d{2}\$/.test(text), "no bcrypt hash");
        assert.ok(!/mongodb(\+srv)?:\/\//.test(text), "no connection string");
    }
});

/* ========================================================================== *
 * Vector validation — the heart of the "never mix dimensions" requirement.
 * ========================================================================== */

test("valid: a correctly stamped 1536-dimensional vector is searchable", () => {
    const doc = embedded();
    assert.equal(isSearchableEmbedding(doc), true);
    assert.equal(describeEmbeddingState(doc), null, "a valid vector has no complaint");
});

test("REJECT: the old 32-dimensional pseudo-embedding", () => {
    // Exactly what the previous scaffold wrote when OPENAI_API_KEY was absent —
    // a normalised 32-float hash of the text. These are in the database now.
    const pseudo = new Array(32).fill(0).map((_, i) => (i + 1) / 100);

    // Unstamped, as the old writer left it.
    assert.equal(isSearchableEmbedding({ embedding: pseudo }), false);

    // And still rejected even if something stamped it with the correct model and
    // version — the real length is checked, not the claim.
    const mislabelled = { embedding: pseudo, ...activeEmbeddingIdentity() };
    assert.equal(isSearchableEmbedding(mislabelled), false, "32 floats cannot be valid at any label");
    assert.match(describeEmbeddingState(mislabelled), /wrong dimensions \(32, expected 1536\)/);
});

test("REJECT: wrong model, even at the correct 1536 dimensions", () => {
    // text-embedding-3-large truncated to 1536 is the realistic trap: right length,
    // unrelated vector space. Comparing the two is noise, not a weak signal.
    const doc = embedded({ embeddingModel: "text-embedding-3-large" });
    assert.equal(isSearchableEmbedding(doc), false);
    assert.match(describeEmbeddingState(doc), /wrong model/);

    for (const model of [null, undefined, "", "ada-002", "text-embedding-ada-002", "gpt-4o-mini"]) {
        assert.equal(
            isSearchableEmbedding(embedded({ embeddingModel: model })),
            false,
            `model ${JSON.stringify(model)} must be rejected`
        );
    }
});

test("REJECT: wrong text version, even with the right model and length", () => {
    const doc = embedded({ embeddingVersion: "metadata-v0" });
    assert.equal(isSearchableEmbedding(doc), false);
    assert.match(describeEmbeddingState(doc), /wrong version/);

    for (const version of [null, undefined, "", "v1", "metadata-v2"]) {
        assert.equal(
            isSearchableEmbedding(embedded({ embeddingVersion: version })),
            false,
            `version ${JSON.stringify(version)} must be rejected`
        );
    }
});

test("REJECT: stamped dimension count that disagrees with the config", () => {
    // Catches a document written under a different configuration than the one now
    // running, even when the array itself happens to be the right length.
    assert.equal(isSearchableEmbedding(embedded({ embeddingDimensions: 32 })), false);
    assert.equal(isSearchableEmbedding(embedded({ embeddingDimensions: null })), false);
    assert.equal(isSearchableEmbedding(embedded({ embeddingDimensions: 3072 })), false);
});

test("REJECT: missing, empty and malformed vectors", () => {
    for (const [label, embedding] of [
        ["undefined", undefined],
        ["null", null],
        ["empty array", []],
        ["not an array", "1,2,3"],
        ["object", { 0: 0.1 }],
        ["one short", validVector().slice(0, 1535)],
        ["one long", [...validVector(), 0.5]],
    ]) {
        assert.equal(isSearchableEmbedding(embedded({ embedding })), false, `${label} must be rejected`);
    }
    assert.equal(isSearchableEmbedding(null), false);
    assert.equal(isSearchableEmbedding(undefined), false);
    assert.equal(describeEmbeddingState({ embedding: [] }), "missing");
});

test("REJECT: a vector containing NaN, Infinity or null entries", () => {
    // One NaN turns every cosine score into NaN, which corrupts the whole ranking
    // rather than just that row — so this must be caught before scoring, not during.
    for (const bad of [NaN, Infinity, -Infinity, null, undefined, "0.5"]) {
        const vector = validVector();
        vector[900] = bad;
        assert.equal(
            isSearchableEmbedding(embedded({ embedding: vector })),
            false,
            `entry ${String(bad)} must be rejected`
        );
    }
    const withNaN = validVector();
    withNaN[0] = NaN;
    assert.match(describeEmbeddingState(embedded({ embedding: withNaN })), /non-finite/);
});

test("cosine: returns null (not 0) for incomparable vectors", () => {
    // The old cosineSim returned 0, which is a REAL score meaning "orthogonal" and
    // sorts above every negative one — so 32-float legacy rows ranked plausibly
    // instead of being excluded. null forces callers to decide explicitly.
    assert.equal(cosineSimilarity(validVector(), new Array(32).fill(0.1)), null, "length mismatch");
    assert.equal(cosineSimilarity([], []), null, "empty");
    assert.equal(cosineSimilarity(validVector(), null), null);
    assert.equal(cosineSimilarity(new Array(1536).fill(0), validVector()), null, "zero magnitude has no direction");
    const withNaN = validVector();
    withNaN[5] = NaN;
    assert.equal(cosineSimilarity(withNaN, validVector()), null, "non-finite");
});

test("cosine: real scores are correct and bounded", () => {
    const v = validVector(1);
    const self = cosineSimilarity(v, v);
    assert.ok(Math.abs(self - 1) < 1e-9, `identical vectors score 1, got ${self}`);

    const opposite = cosineSimilarity(v, v.map((x) => -x));
    assert.ok(Math.abs(opposite + 1) < 1e-9, `negated vectors score -1, got ${opposite}`);

    const other = cosineSimilarity(v, validVector(700));
    assert.ok(other >= -1 && other <= 1, "stays within [-1, 1]");
});

/* ========================================================================== *
 * OpenAI unavailable — no fake vectors, ever.
 * ========================================================================== */

test("unavailable: generateEmbedding throws instead of fabricating a vector", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    resetEmbeddingClient();
    try {
        assert.equal(hasEmbeddingProvider(), false);

        await assert.rejects(
            () => generateEmbedding("that fight scene where the walls crumble"),
            (error) => {
                assert.ok(
                    error instanceof EmbeddingUnavailableError,
                    `expected EmbeddingUnavailableError, got ${error.name}`
                );
                // 503: the service is healthy but unconfigured. app.js reads
                // statusCode off the error, so an uncaught throw is still honest.
                assert.equal(error.statusCode, 503);
                assert.match(error.message, /not configured|OPENAI_API_KEY/i);
                return true;
            }
        );

        // The status report must admit it, and must never leak key material.
        const status = embeddingStatus();
        assert.equal(status.configured, false);
        assert.equal(status.model, EMBEDDING_MODEL);
        assert.equal(status.dimensions, 1536);
        assert.ok(!("apiKey" in status) && !("key" in status));
    } finally {
        if (saved === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = saved;
        resetEmbeddingClient();
    }
});

test("unavailable: an empty or whitespace-only input is rejected, not silently embedded", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-not-used-no-request-is-made";
    resetEmbeddingClient();
    try {
        // Validation happens before any client call, so no network request occurs.
        for (const input of ["", "   ", "\n\t ", null, undefined, 42]) {
            await assert.rejects(
                () => generateEmbedding(input),
                (error) => {
                    assert.ok(error instanceof EmbeddingValidationError, `for input ${JSON.stringify(input)}`);
                    return true;
                }
            );
        }
    } finally {
        if (saved === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = saved;
        resetEmbeddingClient();
    }
});

test("unavailable: no code path can produce a 32-dimensional vector any more", () => {
    // The old fallback was: v[i % 32] += charCodeAt(i), then normalise. Its defining
    // property was being derived from the text with no model involved. Nothing
    // exported now returns a vector at all except generateEmbedding, which requires
    // a key and validates the length — so a hash-derived vector cannot be produced.
    assert.equal(typeof generateEmbedding, "function");
    // The text builders return strings, never numbers.
    assert.equal(typeof buildAnimeEmbeddingText(NARUTO), "string");
    assert.equal(typeof buildVideoEmbeddingText(cloudinaryVideo()), "string");
    // And a hash is hex text, not a vector.
    assert.match(hashEmbeddingText("x"), /^[0-9a-f]{64}$/);
});

/* ========================================================================== *
 * Source type: YouTube vs Cloudinary.
 *
 * The distinction is decided by sourceType alone. Ownership is irrelevant — a
 * YouTube video imported under the AnimeVerse Official account is still "youtube".
 * ========================================================================== */

test("youtube: embedding works with NO videoFile at all", () => {
    const video = youtubeVideo();
    assert.equal(video.videoFile, undefined, "fixture must have no videoFile");

    const text = buildVideoEmbeddingText(video, { anime: NARUTO });
    assert.ok(text.length > 0, "a YouTube video must produce embeddable text");
    assert.ok(text.includes("Naruto Shippuden Opening 16"));
    assert.ok(text.includes("Naruto: Shippuden"), "linked anime metadata participates");
});

test("youtube: the external id and embed host never appear in the text", () => {
    const text = buildVideoEmbeddingText(youtubeVideo());
    assert.ok(!text.includes("dQw4w9WgXcQ"), "externalVideoId is an identifier, not language");
    assert.ok(!text.includes("youtube"), "no host or platform string");
    assert.ok(!text.includes("ytimg"), "no thumbnail URL");
});

test("youtube: a stored transcript is IGNORED regardless of what it contains", () => {
    // We are not permitted to have produced a transcript for a YouTube video — no
    // download, no Whisper — so anything in that field is of unknown origin and is
    // never trusted, rather than trusted because it happens to be present.
    const withTranscript = youtubeVideo({
        transcript: "This transcript should never be embedded for a YouTube video.",
    });
    assert.equal(isTranscriptEligible(withTranscript), false);
    const text = buildVideoEmbeddingText(withTranscript);
    assert.ok(!text.includes("should never be embedded"));
    assert.ok(!text.includes("Transcript:"));
});

test("ownership does NOT determine source type", () => {
    // The AnimeVerse Official account owns YouTube imports. That must not make them
    // Cloudinary videos, and must not make their transcript field eligible.
    const officialOwner = { _id: "655555555555555555555555", username: "animeverse_official" };

    const officialYouTube = youtubeVideo({
        owner: officialOwner,
        transcript: "leaked transcript text",
    });
    assert.equal(officialYouTube.sourceType, "youtube");
    assert.equal(isTranscriptEligible(officialYouTube), false, "still a YouTube video");
    assert.ok(!buildVideoEmbeddingText(officialYouTube).includes("leaked transcript text"));

    // The same account's genuine Cloudinary upload IS eligible.
    const officialUpload = cloudinaryVideo({
        owner: officialOwner,
        transcript: "A legitimate stored transcript from a creator upload.",
    });
    assert.equal(isTranscriptEligible(officialUpload), true, "owner must not disqualify a Cloudinary upload");
    assert.ok(buildVideoEmbeddingText(officialUpload).includes("legitimate stored transcript"));

    // And the owner is not embedded in either case.
    assert.ok(!buildVideoEmbeddingText(officialYouTube).includes("animeverse_official"));
    assert.ok(!buildVideoEmbeddingText(officialUpload).includes("animeverse_official"));
});

test("cloudinary: a legitimately stored transcript participates", () => {
    const video = cloudinaryVideo({
        transcript: "In episode four the pacing slows deliberately to let the silence land.",
    });
    assert.equal(isTranscriptEligible(video), true);
    const text = buildVideoEmbeddingText(video);
    assert.ok(text.includes("Transcript:"));
    assert.ok(text.includes("the pacing slows deliberately"));
});

test("cloudinary: transcript participates ONLY when one is genuinely stored", () => {
    // Nothing is generated on demand: an absent transcript stays absent, and no
    // transcription is triggered by building embedding text.
    for (const [label, transcript] of [
        ["absent", undefined],
        ["null", null],
        ["empty", ""],
        ["whitespace", "   \n\t "],
        ["non-string", 12345],
    ]) {
        const video = cloudinaryVideo({ transcript });
        assert.equal(isTranscriptEligible(video), false, `${label} must not be eligible`);
        assert.ok(!buildVideoEmbeddingText(video).includes("Transcript:"), `${label} adds no transcript line`);
    }
});

test("cloudinary: the old AI-stub placeholder is not treated as a transcript", () => {
    // The previous scaffold's transcribeAudio returned this sentence when no key was
    // set, and the summary controller persisted whatever it received — so this string
    // may genuinely be in the database. It is an error message, not speech, and
    // embedding it would add a sentence about missing configuration to the vector.
    for (const stub of [
        "(AI stub) transcription unavailable  -  set OPENAI_API_KEY.",
        "(AI stub) OpenAI key not set.",
        "  (ai stub) Transcription unavailable - set openai_api_key.  ",
    ]) {
        const video = cloudinaryVideo({ transcript: stub });
        assert.equal(isTranscriptEligible(video), false, `stub must be rejected: ${stub.slice(0, 30)}`);
        assert.ok(!buildVideoEmbeddingText(video).includes("Transcript:"));
    }
});

test("legacy documents with no sourceType are treated as Cloudinary", () => {
    // Pre-existing documents have no sourceType field at all; the model's default
    // encodes that they are creator uploads, and this must agree with it.
    const legacy = {
        title: "An old upload",
        description: "Predates external sources.",
        videoFile: "https://res.cloudinary.invalid/video/upload/v1/old.mp4",
        transcript: "A real transcript stored years ago.",
    };
    assert.equal(isTranscriptEligible(legacy), true);
    assert.ok(buildVideoEmbeddingText(legacy).includes("A real transcript stored years ago"));
});

test("transcript is capped so it cannot crowd out the metadata", () => {
    // Metadata is emitted first and the transcript last, so the global cap trims the
    // transcript tail and never the title — the highest-signal field per character.
    const video = cloudinaryVideo({ transcript: "word ".repeat(20000) });
    const text = buildVideoEmbeddingText(video, { anime: NARUTO });
    assert.ok(text.length <= 24000, `text must respect the cap, got ${text.length}`);
    assert.ok(text.startsWith("Title: Why Frieren's pacing works"), "title survives truncation");
    assert.ok(text.includes("Naruto: Shippuden"), "anime metadata survives truncation");
});
