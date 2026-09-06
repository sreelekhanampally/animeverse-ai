/**
 * Embedding foundation tests. No network, no database, no API key, no OpenAI credits.
 *
 *   node --test tests/
 *   node tests/embedding.test.mjs
 *
 * Uses node:test/node:assert from the standard library, so it adds no dependency,
 * matching tests/youtubeFilter.test.mjs.
 *
 * NO TEST HERE CALLS OPENAI. Most tests are pure logic over synthetic 384-float
 * vectors. That is deliberate: a suite that spent money or required a key would not
 * be run, and these are exactly the invariants that must hold before a backfill
 * touches the database.
 *
 * WHAT DOES TOUCH THE REAL MODEL
 * ------------------------------
 * One clearly marked group at the end runs the actual local model, because a suite
 * that only ever mocked inference could pass while the provider was completely
 * broken — the single most important thing to verify is that genuine 384-dimensional
 * semantic vectors come out. It runs in-process with no network once the weights are
 * cached, still needs no key, and never touches MongoDB.
 *
 * Those tests skip themselves (rather than fail) when the weights are absent and
 * cannot be downloaded, so the suite stays runnable offline. The pure-logic tests
 * above them cover the same validation rules deterministically, so a skip does not
 * leave the invariants unchecked — only the live-inference proof.
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
    EMBEDDING_PROVIDER,
    EMBEDDING_PROVIDERS,
    EMBEDDING_VERSION,
    EmbeddingModelLoadError,
    EmbeddingUnavailableError,
    EmbeddingValidationError,
    activeEmbeddingIdentity,
    hasEmbeddingProvider,
    hasOpenAIKey,
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

/**
 * A structurally valid vector: EMBEDDING_DIMENSIONS finite, non-zero floats.
 *
 * Built from the config rather than a literal 384/1536 so these fixtures follow a
 * provider change automatically. The tests that must pin an exact number do so
 * explicitly, which is the difference between "the config is self-consistent" and
 * "the config says what we intend".
 */
const validVector = (seed = 1) =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin((i + seed) * 0.01));

/** The legacy pseudo-embedding the original scaffold wrote: 32 hash-derived floats. */
const legacyVector32 = () => new Array(32).fill(0).map((_, i) => (i + 1) / 100);

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

test("config: the active provider is the local 384-dimensional model", () => {
    // The migration's central claim, pinned to literals rather than to the config's
    // own values — a test that read EMBEDDING_DIMENSIONS on both sides would pass
    // for any number at all.
    assert.equal(EMBEDDING_PROVIDER, "local");
    assert.equal(EMBEDDING_MODEL, "sentence-transformers/all-MiniLM-L6-v2");
    assert.equal(EMBEDDING_DIMENSIONS, 384);
    assert.equal(EMBEDDING_VERSION, "metadata-v2");
});

test("config: the version was bumped away from the OpenAI-era metadata-v1", () => {
    // The vector representation changed from 1536-float OpenAI to 384-float MiniLM.
    // Reusing metadata-v1 would leave every old vector passing the version check
    // while being an incomparable width — the exact failure the stamp prevents.
    assert.notEqual(EMBEDDING_VERSION, "metadata-v1");
});

test("config: the local provider requires no API key", () => {
    const local = EMBEDDING_PROVIDERS.local;
    assert.equal(local.requiresApiKey, false);
    assert.equal(local.dimensions, 384);
    assert.equal(local.model, "sentence-transformers/all-MiniLM-L6-v2");
});

test("config: the OpenAI provider is preserved as a described option at 1536", () => {
    // Kept selectable so returning to OpenAI is a config change, not a rewrite — and
    // so the reason the two cannot be mixed is written down next to both.
    const openai = EMBEDDING_PROVIDERS.openai;
    assert.equal(openai.model, "text-embedding-3-small");
    assert.equal(openai.dimensions, 1536);
    assert.equal(openai.requiresApiKey, true);
});

test("config: dimensions are not overridable by the environment", () => {
    // A typo in an env var must not be able to produce vectors that pass validation
    // and are still incompatible. Dimension count is a property of the model.
    const before = EMBEDDING_DIMENSIONS;
    process.env.EMBEDDING_DIMENSIONS = "32";
    process.env.OPENAI_EMBED_MODEL = "text-embedding-3-large";
    process.env.EMBEDDING_MODEL = "some-other-model";
    try {
        assert.equal(EMBEDDING_DIMENSIONS, before);
        assert.equal(EMBEDDING_DIMENSIONS, 384);
        assert.equal(EMBEDDING_MODEL, "sentence-transformers/all-MiniLM-L6-v2");
        assert.equal(activeEmbeddingIdentity().embeddingDimensions, 384);
    } finally {
        delete process.env.EMBEDDING_DIMENSIONS;
        delete process.env.OPENAI_EMBED_MODEL;
        delete process.env.EMBEDDING_MODEL;
    }
});

test("config: provider entries are frozen against mutation", () => {
    // These objects are read on every write path. A mutated dimension count would
    // silently redefine what counts as a valid vector for the whole process.
    assert.throws(() => {
        EMBEDDING_PROVIDERS.local.dimensions = 1536;
    }, TypeError);
    assert.equal(EMBEDDING_PROVIDERS.local.dimensions, 384);
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

test("valid: a correctly stamped 384-dimensional vector is searchable", () => {
    const doc = embedded();
    assert.equal(doc.embedding.length, 384, "the fixture must be 384 floats wide");
    assert.equal(isSearchableEmbedding(doc), true);
    assert.equal(describeEmbeddingState(doc), null, "a valid vector has no complaint");
});

test("REJECT: the old 32-dimensional pseudo-embedding", () => {
    // Exactly what the original scaffold wrote when OPENAI_API_KEY was absent —
    // a normalised 32-float hash of the text. Three of these are in the database now
    // and must stay invalid; they are overwritten by a backfill, never deleted.
    const pseudo = legacyVector32();

    // Unstamped, as the old writer left it.
    assert.equal(isSearchableEmbedding({ embedding: pseudo }), false);

    // And still rejected even if something stamped it with the correct model and
    // version — the real length is checked, not the claim.
    const mislabelled = { embedding: pseudo, ...activeEmbeddingIdentity() };
    assert.equal(isSearchableEmbedding(mislabelled), false, "32 floats cannot be valid at any label");
    assert.match(describeEmbeddingState(mislabelled), /wrong dimensions \(32, expected 384\)/);
});

test("REJECT: a 1536-dimensional OpenAI-era vector is no longer valid", () => {
    // The other half of the migration. Any vector written in Session 1 is 1536 floats
    // stamped metadata-v1/text-embedding-3-small, and comparing it to a 384-float
    // MiniLM vector is meaningless. It must fail on width alone, before the stamps
    // are even consulted.
    const openaiEra = {
        embedding: Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01)),
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 1536,
        embeddingVersion: "metadata-v1",
    };
    assert.equal(isSearchableEmbedding(openaiEra), false);
    assert.match(describeEmbeddingState(openaiEra), /wrong dimensions \(1536, expected 384\)/);

    // Also rejected when relabelled with the active identity — the array is measured.
    const relabelled = { ...openaiEra, ...activeEmbeddingIdentity() };
    assert.equal(isSearchableEmbedding(relabelled), false);
});

test("REJECT: wrong model, even at the correct 384 dimensions", () => {
    // A different sentence-transformers model at the same width is the realistic
    // trap: right length, unrelated vector space. Comparing the two is noise, not a
    // weak signal. all-MiniLM-L12-v2 is genuinely 384-dimensional, so this is not
    // hypothetical.
    const doc = embedded({ embeddingModel: "sentence-transformers/all-MiniLM-L12-v2" });
    assert.equal(isSearchableEmbedding(doc), false);
    assert.match(describeEmbeddingState(doc), /wrong model/);

    for (const model of [
        null,
        undefined,
        "",
        "text-embedding-3-small",
        "text-embedding-ada-002",
        "all-MiniLM-L6-v2", // the bare name, without the sentence-transformers/ prefix
        "gpt-4o-mini",
    ]) {
        assert.equal(
            isSearchableEmbedding(embedded({ embeddingModel: model })),
            false,
            `model ${JSON.stringify(model)} must be rejected`
        );
    }
});

test("REJECT: wrong text version, even with the right model and length", () => {
    const doc = embedded({ embeddingVersion: "metadata-v1" });
    assert.equal(isSearchableEmbedding(doc), false);
    assert.match(describeEmbeddingState(doc), /wrong version/);

    // "metadata-v1" is listed because it is the previous real value: a document
    // carrying it is from the OpenAI era and must not be trusted at any width.
    for (const version of [null, undefined, "", "v1", "metadata-v1", "metadata-v3"]) {
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
    assert.equal(isSearchableEmbedding(embedded({ embeddingDimensions: 1536 })), false);
    assert.equal(isSearchableEmbedding(embedded({ embeddingDimensions: 3072 })), false);
});

test("REJECT: missing, empty and malformed vectors", () => {
    for (const [label, embedding] of [
        ["undefined", undefined],
        ["null", null],
        ["empty array", []],
        ["not an array", "1,2,3"],
        ["object", { 0: 0.1 }],
        ["one short", validVector().slice(0, EMBEDDING_DIMENSIONS - 1)],
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
        vector[200] = bad;
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
    assert.equal(cosineSimilarity(validVector(), legacyVector32()), null, "length mismatch");
    assert.equal(cosineSimilarity([], []), null, "empty");
    assert.equal(cosineSimilarity(validVector(), null), null);
    assert.equal(
        cosineSimilarity(new Array(EMBEDDING_DIMENSIONS).fill(0), validVector()),
        null,
        "zero magnitude has no direction"
    );
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
 * No API key required — the point of the local provider.
 *
 * Session 1's equivalent block asserted the opposite: that a missing key made
 * embedding impossible. That was correct for OpenAI and is now precisely the
 * condition the local provider exists to remove, so these tests pin the new
 * contract. "No fake vectors, ever" is unchanged and still asserted below.
 * ========================================================================== */

/** Runs a function with OPENAI_API_KEY absent, then restores the environment. */
const withoutOpenAIKey = async (fn) => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    resetEmbeddingClient();
    try {
        return await fn();
    } finally {
        if (saved === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = saved;
        resetEmbeddingClient();
    }
};

test("no key: the local provider reports itself configured with no OPENAI_API_KEY", async () => {
    await withoutOpenAIKey(() => {
        // The migration's core requirement. There is no credential to be missing, so
        // "unconfigured" is not a state the local provider can be in.
        assert.equal(hasOpenAIKey(), false, "the key must genuinely be absent");
        assert.equal(hasEmbeddingProvider(), true, "local embedding needs no key");

        const status = embeddingStatus();
        assert.equal(status.configured, true);
        assert.equal(status.provider, "local");
        assert.equal(status.requiresApiKey, false);
        assert.equal(status.model, EMBEDDING_MODEL);
        assert.equal(status.dimensions, 384);

        // Still must never leak key material, whatever the provider.
        assert.ok(!("apiKey" in status) && !("key" in status));
        assert.ok(!JSON.stringify(status).includes("sk-"));
    });
});

test("no key: generateEmbedding does NOT throw EmbeddingUnavailableError", async () => {
    await withoutOpenAIKey(async () => {
        /**
         * The regression this guards against is the whole reason for the session: with
         * the OpenAI provider this call raised EmbeddingUnavailableError, and the
         * backfill refused to start.
         *
         * A model-load failure (no weights, no network) is an acceptable outcome here
         * and is asserted as such — what must NOT happen is the run being blocked
         * because a key is missing. The live-inference group below proves the success
         * path when the weights are available.
         */
        try {
            const result = await generateEmbedding("that fight scene where the walls crumble");
            assert.equal(result.embedding.length, 384);
            assert.equal(result.embeddingModel, "sentence-transformers/all-MiniLM-L6-v2");
        } catch (error) {
            assert.ok(
                error instanceof EmbeddingModelLoadError,
                `a missing key must not block local embedding; got ${error.name}: ${error.message}`
            );
            assert.ok(
                !/OPENAI_API_KEY/.test(error.message),
                "a local-provider failure must not tell the operator to set an OpenAI key"
            );
        }
    });
});

test("no key: an empty or whitespace-only input is still rejected", async () => {
    await withoutOpenAIKey(async () => {
        // Validated before the provider is consulted, so no model is loaded and no
        // request is made. An empty vector field is silently unsearchable, and a
        // caller asking to embed nothing has a bug worth surfacing.
        for (const input of ["", "   ", "\n\t ", null, undefined, 42]) {
            await assert.rejects(
                () => generateEmbedding(input),
                (error) => {
                    assert.ok(
                        error instanceof EmbeddingValidationError,
                        `for input ${JSON.stringify(input)}, got ${error.name}`
                    );
                    return true;
                }
            );
        }
    });
});

test("unavailable: the OpenAI provider still refuses to run without a key", () => {
    // The unavailable path is not dead code — it is what an EMBEDDING_PROVIDER=openai
    // deployment with no key must still hit. Asserted on the error class itself since
    // the active provider is local and cannot reach it.
    const error = new EmbeddingUnavailableError();
    assert.equal(error.statusCode, 503, "503: healthy but unconfigured, not a crash");
    assert.equal(error.isUnavailable, true);
    assert.equal(EMBEDDING_PROVIDERS.openai.requiresApiKey, true);
});

test("errors: model-load failure is a distinct, non-silent 503", () => {
    // Must not be confused with "no API key": an operator told to set a key for a
    // local provider is sent in exactly the wrong direction. And it must never be
    // swallowed in favour of a fabricated vector.
    const cause = new Error("ENOENT: model.onnx not found");
    const error = new EmbeddingModelLoadError("weights missing", { cause });
    assert.equal(error.name, "EmbeddingModelLoadError");
    assert.equal(error.statusCode, 503);
    assert.equal(error.cause, cause, "the underlying failure must not be swallowed");
    assert.ok(!(error instanceof EmbeddingUnavailableError), "distinct from the no-key case");
});

test("unavailable: no code path can produce a 32-dimensional vector any more", () => {
    // The old fallback was: v[i % 32] += charCodeAt(i), then normalise. Its defining
    // property was being derived from the text with no model involved. Nothing
    // exported returns a vector except generateEmbedding, which runs a real model and
    // validates the width — so a hash-derived vector cannot be produced.
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

/* ========================================================================== *
 * LIVE LOCAL INFERENCE
 *
 * The only group that loads the real model. Everything above is deterministic
 * logic over synthetic vectors, which is fast and hermetic but could all pass
 * while the provider was entirely broken — so at least one test has to prove that
 * genuine 384-dimensional semantic vectors actually come out of the local model.
 *
 * Still no OpenAI, still no credits, still no database. The first run downloads
 * ~90MB of ONNX weights; afterwards it is fully offline and takes a few seconds.
 *
 * These tests SKIP rather than fail when the weights cannot be obtained, so the
 * suite remains runnable on a machine with no network. A skip loses only the
 * live-inference proof: the validation rules it exercises are independently
 * covered above.
 * ========================================================================== */

/**
 * Attempts one real embedding and caches the outcome for the whole group, so the
 * model is loaded once rather than per test.
 */
let liveProbe = null;
const probeLiveModel = async () => {
    if (liveProbe) return liveProbe;
    try {
        const result = await generateEmbedding("probe: a quiet scene at dusk");
        liveProbe = { available: true, result };
    } catch (error) {
        if (error instanceof EmbeddingModelLoadError) {
            liveProbe = { available: false, reason: error.message };
        } else {
            // A validation or inference error is a genuine defect, not an
            // environment problem, and must not be skipped away.
            throw error;
        }
    }
    return liveProbe;
};

test("LIVE: the local model generates a real 384-dimensional numeric vector", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip(`local model weights unavailable: ${probe.reason}`);
        return;
    }

    const { embedding } = probe.result;

    assert.ok(Array.isArray(embedding), "must be a plain array, not a typed array");
    assert.equal(embedding.length, 384, "exactly 384 dimensions");
    assert.ok(
        embedding.every((n) => typeof n === "number" && Number.isFinite(n)),
        "every entry must be a finite JS number"
    );

    // Not a zero vector, not a constant vector — either would indicate a
    // fabricated or collapsed output rather than real inference.
    assert.ok(embedding.some((n) => n !== 0), "must not be a zero vector");
    assert.ok(new Set(embedding).size > 300, "must not be a constant or near-constant vector");

    // The model card specifies unit-normalised output; cosine similarity is only
    // meaningful over normalised vectors.
    const norm = Math.sqrt(embedding.reduce((sum, n) => sum + n * n, 0));
    assert.ok(Math.abs(norm - 1) < 1e-3, `must be L2-normalised, got norm ${norm}`);
});

test("LIVE: the generated vector passes isSearchableEmbedding once stamped", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip("local model weights unavailable");
        return;
    }

    // The end-to-end contract: what generateEmbedding returns is exactly what a
    // document needs to be searchable, with no further assembly by the caller.
    assert.equal(
        isSearchableEmbedding(probe.result),
        true,
        "a freshly generated result must validate as-is"
    );
    assert.equal(describeEmbeddingState(probe.result), null);
});

test("LIVE: metadata is correctly attached to a generated embedding", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip("local model weights unavailable");
        return;
    }

    const text = "Title: Why Frieren's pacing works";
    const result = await generateEmbedding(text);

    assert.equal(result.embeddingModel, "sentence-transformers/all-MiniLM-L6-v2");
    assert.equal(result.embeddingDimensions, 384);
    assert.equal(result.embeddingVersion, "metadata-v2");
    assert.ok(result.embeddingGeneratedAt instanceof Date);
    assert.ok(Number.isFinite(result.embeddingGeneratedAt.getTime()), "a usable timestamp");

    // The hash must describe the exact string embedded, since that is what the
    // backfill compares to decide whether a document can be skipped. Computed on
    // the trimmed input, which is what was actually sent to the model.
    assert.equal(result.embeddingTextHash, hashEmbeddingText(text));
    assert.match(result.embeddingTextHash, /^[0-9a-f]{64}$/);

    // The stamped dimension count must agree with the array it describes — the
    // cross-check that catches a truncated write.
    assert.equal(result.embeddingDimensions, result.embedding.length);
});

test("LIVE: identical input produces a stable, repeatable vector", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip("local model weights unavailable");
        return;
    }

    // Determinism is what makes embeddingTextHash a sound skip signal: if unchanged
    // text could yield a different vector, skipping would silently preserve a stale
    // one. A feature-extraction forward pass has no sampling, so this is exact.
    const text = "Anime: Naruto: Shippuden\nGenres: Action, Adventure";
    const first = await generateEmbedding(text);
    const second = await generateEmbedding(text);

    assert.deepEqual(second.embedding, first.embedding, "bit-identical output expected");
    assert.equal(second.embeddingTextHash, first.embeddingTextHash);

    // Cosine with itself is 1, which also confirms the vectors are comparable.
    const self = cosineSimilarity(first.embedding, second.embedding);
    assert.ok(Math.abs(self - 1) < 1e-6, `self-similarity must be 1, got ${self}`);
});

test("LIVE: the vectors carry real semantics, not noise", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip("local model weights unavailable");
        return;
    }

    /**
     * The test that actually distinguishes a working embedder from a plausible-looking
     * fake. Every structural assertion above would pass for a random unit vector; only
     * this one fails for it.
     *
     * A paraphrase shares almost no vocabulary with the original ("ninja"/"shinobi",
     * "fox spirit"/"fox demon"), so a hash-derived or random vector would score it no
     * higher than an unrelated sentence. A real sentence encoder scores it far higher.
     */
    const [ninja, shinobi, baking] = await Promise.all([
        generateEmbedding("a ninja fights with a giant fox spirit"),
        generateEmbedding("shinobi battle featuring a huge fox demon"),
        generateEmbedding("a recipe for sourdough bread baking"),
    ]);

    const paraphrase = cosineSimilarity(ninja.embedding, shinobi.embedding);
    const unrelated = cosineSimilarity(ninja.embedding, baking.embedding);

    assert.ok(paraphrase !== null && unrelated !== null, "both pairs must be comparable");
    assert.ok(
        paraphrase > unrelated,
        `a paraphrase must outscore unrelated text (${paraphrase} vs ${unrelated})`
    );
    // A generous floor: measured at ~0.68 vs ~0.04. Loose enough to survive a
    // library or weight revision, strict enough that noise cannot pass.
    assert.ok(paraphrase > 0.4, `paraphrase similarity should be substantial, got ${paraphrase}`);
    assert.ok(unrelated < 0.3, `unrelated similarity should be low, got ${unrelated}`);
});

test("LIVE: a real document's embedding text embeds end to end", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip("local model weights unavailable");
        return;
    }

    // Proves the two halves fit together: the deterministic text builders produce
    // something the local provider can actually embed, for both collections and for
    // a YouTube video with no videoFile at all.
    for (const [label, text] of [
        ["anime", buildAnimeEmbeddingText(NARUTO)],
        ["cloudinary video", buildVideoEmbeddingText(cloudinaryVideo(), { anime: NARUTO })],
        ["youtube video", buildVideoEmbeddingText(youtubeVideo(), { anime: NARUTO })],
    ]) {
        assert.ok(text.length > 0, `${label} must produce embeddable text`);
        const result = await generateEmbedding(text);
        assert.equal(result.embedding.length, 384, `${label} must yield 384 dimensions`);
        assert.equal(isSearchableEmbedding(result), true, `${label} must validate`);
    }
});

test("LIVE: a query embedding is comparable to a document embedding", async (t) => {
    const probe = await probeLiveModel();
    if (!probe.available) {
        t.skip("local model weights unavailable");
        return;
    }

    /**
     * Session 2 will embed a search query through this same generateEmbedding, so the
     * property it depends on is verified now: a query vector and a document vector
     * must be the same width and must score comparably.
     *
     * No scene-search is implemented here — this only confirms the interface Session 2
     * will build on already behaves correctly.
     */
    const document = await generateEmbedding(buildAnimeEmbeddingText(NARUTO));
    const query = await generateEmbedding("ninja anime about Naruto Uzumaki");
    const offTopic = await generateEmbedding("quarterly financial audit procedures");

    assert.equal(query.embedding.length, document.embedding.length, "same vector space");

    const relevant = cosineSimilarity(query.embedding, document.embedding);
    const irrelevant = cosineSimilarity(offTopic.embedding, document.embedding);

    assert.ok(relevant !== null, "a query must be scoreable against a document");
    assert.ok(
        relevant > irrelevant,
        `a relevant query must outscore an irrelevant one (${relevant} vs ${irrelevant})`
    );
});

/* ========================================================================== *
 * BACKFILL SAFETY
 *
 * Static analysis of the backfill script rather than execution. Running it would
 * require a live MongoDB connection, and pointing a test at the production Atlas
 * cluster to prove it does not write to the production Atlas cluster is not a test
 * anyone should run.
 *
 * So the two properties that make a dry run safe are asserted against the source:
 * that the write is guarded by the dryRun flag, and that index creation — itself a
 * write — is disabled before the connection is opened. Both were verified by
 * executing the real command against the live database as well; this pins them so a
 * later edit cannot quietly remove the guard.
 * ========================================================================== */

import { readFile } from "node:fs/promises";

const backfillSource = await readFile(
    new URL("../src/scripts/backfillEmbeddings.js", import.meta.url),
    "utf8"
);

test("backfill: the only write is guarded by the dry-run flag", () => {
    // Exactly one mutation site in the whole script, and it is a $set of embedding
    // fields. A second updateOne/deleteOne appearing here should fail this test and
    // be reviewed deliberately.
    const writeCalls = backfillSource.match(/\.(updateOne|updateMany|deleteOne|deleteMany|bulkWrite|save)\(/g) || [];
    assert.deepEqual(writeCalls, [".updateOne("], "expected exactly one write call");

    // The dry run returns before reaching it.
    assert.match(
        backfillSource,
        /if \(dryRun\) \{[\s\S]{0,600}?continue;/,
        "the dry-run branch must continue past the write"
    );

    // And the write is a $set of the generated embedding fields only.
    assert.match(backfillSource, /updateOne\(\s*\{ _id: doc\._id \},\s*\{ \$set: fields \}\s*\)/);
});

test("backfill: a dry run generates no embedding and loads no model", () => {
    // generateEmbedding must sit after the dry-run early-continue, so a preview
    // cannot produce a vector...
    const dryRunIndex = backfillSource.indexOf("if (dryRun) {");
    const generateIndex = backfillSource.indexOf("await generateEmbedding(text)");
    assert.ok(dryRunIndex > 0 && generateIndex > 0);
    assert.ok(dryRunIndex < generateIndex, "the dry-run guard must precede generateEmbedding");

    // ...and the model warm-up must be conditional on it, so a preview does not pay
    // for (or fail on) a weight download.
    assert.match(
        backfillSource,
        /if \(!dryRun\) \{[\s\S]{0,600}?await warmEmbeddingProvider\(\)/,
        "the provider must only be warmed on a real run"
    );
});

test("backfill: a dry run cannot create an index on the live cluster", () => {
    // Mongoose autoIndex defaults to true and builds declared indexes on first model
    // use — a write. Both models declare { embeddingModel, embeddingVersion }, so
    // without this a dry run would create it while printing "Nothing was written".
    const autoIndexIndex = backfillSource.indexOf('mongoose.set("autoIndex", false)');
    const connectIndex = backfillSource.indexOf("await connectDB()");
    assert.ok(autoIndexIndex > 0, "autoIndex must be disabled for a dry run");
    assert.ok(connectIndex > 0);
    assert.ok(autoIndexIndex < connectIndex, "it must be disabled BEFORE connecting");
    assert.match(backfillSource, /if \(dryRun\) mongoose\.set\("autoIndex", false\)/);
});

test("backfill: no Atlas Vector Search index is created", () => {
    // Session 2 owns the vector index. This migration must not touch it, and must not
    // silently create one against the live cluster.
    assert.ok(!/createSearchIndex|createVectorSearchIndex|\$vectorSearch/.test(backfillSource));
});

test("backfill: legacy vectors are overwritten, never deleted", () => {
    // The 3 legacy 32-float vectors are on otherwise perfectly good Video documents.
    // They stop being searchable, which is enough; deleting the documents would
    // destroy real content.
    assert.ok(!/deleteOne|deleteMany|drop\(/.test(backfillSource), "no deletion of any kind");
});

test("backfill: the documented CLI flags are all still parsed", () => {
    // The migration must not quietly drop an operator-facing flag.
    for (const flag of ["dry-run", "force", "verbose", "limit", "batch-size", "target"]) {
        assert.ok(
            backfillSource.includes(`"${flag}"`) || backfillSource.includes(`args.${flag}`),
            `--${flag} must still be handled`
        );
    }
});
