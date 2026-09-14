import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    fetchPopularAnimeFromJikan,
    jikanSyntheticAniListId,
    mapJikanAnimeToAnime,
    parseJikanDurationMinutes,
} from "../src/services/jikan.service.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const JIKAN_FIXTURE = {
    mal_id: 5114,
    url: "https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood",
    images: {
        jpg: {
            image_url: "https://cdn.myanimelist.net/images/anime/example.jpg",
            large_image_url: "https://cdn.myanimelist.net/images/anime/example-large.jpg",
        },
    },
    trailer: { youtube_id: "dQw4w9WgXcQ" },
    title: "Fullmetal Alchemist: Brotherhood",
    title_english: "Fullmetal Alchemist: Brotherhood",
    title_japanese: "鋼の錬金術師 FULLMETAL ALCHEMIST",
    type: "TV",
    source: "Manga",
    episodes: 64,
    status: "Finished Airing",
    duration: "24 min per ep",
    rating: "R - 17+ (violence & profanity)",
    score: 9.1,
    members: 3_500_000,
    synopsis: "Two brothers search for a way to restore what they lost.",
    season: "spring",
    year: 2009,
    studios: [{ mal_id: 4, name: "Bones" }],
    genres: [
        { mal_id: 1, name: "Action" },
        { mal_id: 2, name: "Adventure" },
    ],
    aired: { prop: { from: { year: 2009 } } },
};



test("Jikan popularity fetch uses SFW by-popularity ranking and no API key", async () => {
    const originalFetch = global.fetch;
    const requested = [];
    global.fetch = async (url) => {
        requested.push(String(url));
        return new Response(
            JSON.stringify({
                data: [
                    { ...JIKAN_FIXTURE, mal_id: 1 },
                    { ...JIKAN_FIXTURE, mal_id: 2, title: "Second Anime" },
                ],
                pagination: { has_next_page: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
        );
    };

    try {
        const rows = await fetchPopularAnimeFromJikan({ limit: 2 });
        assert.equal(rows.length, 2);
        assert.equal(requested.length, 1);
        const url = new URL(requested[0]);
        assert.equal(url.pathname, "/v4/top/anime");
        assert.equal(url.searchParams.get("filter"), "bypopularity");
        assert.equal(url.searchParams.get("sfw"), "true");
        assert.equal(url.searchParams.get("limit"), "2");
        assert.equal(url.searchParams.has("key"), false);
    } finally {
        global.fetch = originalFetch;
    }
});

test("Jikan fallback ids are deterministic negative surrogates and cannot collide with real AniList ids", () => {
    assert.equal(jikanSyntheticAniListId(5114), -5114);
    assert.equal(jikanSyntheticAniListId("5114"), -5114);
    assert.throws(() => jikanSyntheticAniListId(0), /valid mal_id/);
});

test("Jikan payload maps into the existing Anime schema without inventing unavailable fields", () => {
    const doc = mapJikanAnimeToAnime(JIKAN_FIXTURE);

    assert.equal(doc.anilistId, -5114);
    assert.equal(doc.malId, 5114);
    assert.equal(doc.title.display, "Fullmetal Alchemist: Brotherhood");
    assert.equal(doc.format, "TV");
    assert.equal(doc.status, "FINISHED");
    assert.equal(doc.season, "SPRING");
    assert.equal(doc.seasonYear, 2009);
    assert.equal(doc.duration, 24);
    assert.equal(doc.averageScore, 91);
    assert.equal(doc.popularity, 3_500_000, "higher members count must remain higher popularity");
    assert.deepEqual(doc.genres, ["Action", "Adventure"]);
    assert.deepEqual(doc.studios, ["Bones"]);
    assert.deepEqual(doc.characters, [], "top-anime fallback does not fabricate characters");
    assert.equal(doc.metadataSource, "jikan");
    assert.equal(doc.trailer.id, "dQw4w9WgXcQ");
    assert.equal(doc.trailer.site, "youtube");
});


test("Jikan mapper preserves unknown numeric metadata as null rather than fabricating zero", () => {
    const doc = mapJikanAnimeToAnime({
        ...JIKAN_FIXTURE,
        mal_id: 99999,
        episodes: null,
        year: null,
        aired: { prop: { from: { year: null } } },
        score: null,
    });
    assert.equal(doc.episodes, null);
    assert.equal(doc.seasonYear, null);
    assert.equal(doc.startYear, null);
    assert.equal(doc.averageScore, null);
});

test("Jikan duration parser handles episodes and films", () => {
    assert.equal(parseJikanDurationMinutes("24 min per ep"), 24);
    assert.equal(parseJikanDurationMinutes("1 hr 56 min"), 116);
    assert.equal(parseJikanDurationMinutes("2 hr"), 120);
    assert.equal(parseJikanDurationMinutes("Unknown"), null);
});

test("AniList recovery promotes a matching Jikan fallback document by malId instead of duplicating it", async () => {
    const ingest = await read("src/utils/animeIngest.js");
    assert.match(ingest, /\$or:\s*\[\{ anilistId: doc\.anilistId \}, \{ malId: doc\.malId \}\]/);
    assert.match(ingest, /existing AniList metadata preserved/);
});

test("catalogue growth falls back AniList -> Jikan -> curated -> stored and targets fallback rows directly", async () => {
    const grow = await read("src/scripts/growCatalog.js");
    assert.match(grow, /AniList → Jikan → curated offline → stored/);
    assert.match(grow, /ingestJikan\.js/);
    assert.match(grow, /youtubeMetadataSource: "jikan"/);
    assert.match(grow, /ingestCuratedAnime\.js/);
    assert.match(grow, /youtubeMetadataSource: "curated"/);
    assert.match(grow, /--metadata-source=/);
});

test("YouTube target resolution can scope a batch by metadata source", async () => {
    const [util, cli] = await Promise.all([
        read("src/utils/youtubeIngest.js"),
        read("src/scripts/ingestYouTube.js"),
    ]);
    assert.match(util, /metadataSource \? \{ metadataSource: String\(metadataSource\) \} : \{\}/);
    assert.match(cli, /args\["metadata-source"\]/);
});

test("YouTube quota reporting reflects the 2026 dedicated search bucket", async () => {
    const [service, cli] = await Promise.all([
        read("src/services/youtube.service.js"),
        read("src/scripts/ingestYouTube.js"),
    ]);
    assert.match(service, /search\.list has its own default bucket of 100 calls\/day/);
    assert.match(service, /QUOTA_COST = \{ search: 1, videos: 1 \}/);
    assert.match(cli, /dedicated search bucket/);
    assert.equal(/search:\s*100/.test(service), false);
});
