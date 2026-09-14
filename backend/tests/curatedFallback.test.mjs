import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CURATED_ANIME_CATALOG } from "../src/seeds/curatedAnimeCatalog.js";
import {
    curatedSyntheticAniListId,
    curatedTitleKeys,
    mapCuratedSeedToAnime,
    normalizeCuratedTitle,
} from "../src/services/curatedAnime.service.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("offline curated fallback contains a substantial reviewed expansion catalogue", () => {
    assert.ok(CURATED_ANIME_CATALOG.length >= 120, `expected >=120 seeds, got ${CURATED_ANIME_CATALOG.length}`);

    const keys = new Set();
    const ids = new Set();
    for (const seed of CURATED_ANIME_CATALOG) {
        assert.ok(seed.key && seed.title, "every curated seed needs a stable key and title");
        assert.equal(keys.has(seed.key), false, `duplicate curated key: ${seed.key}`);
        keys.add(seed.key);

        const id = curatedSyntheticAniListId(seed.key);
        assert.ok(id <= -2_000_000_000, "curated ids must stay in their reserved negative namespace");
        assert.equal(ids.has(id), false, `synthetic id collision for ${seed.key}`);
        ids.add(id);
    }
});

test("curated title normalization handles punctuation and common branding differences", () => {
    assert.equal(normalizeCuratedTitle("Fate/stay night: Unlimited Blade Works"), "fate stay night unlimited blade works");
    assert.equal(normalizeCuratedTitle("Hell's Paradise"), "hells paradise");
    assert.equal(normalizeCuratedTitle("  Kaiju   No. 8 "), "kaiju no 8");
});

test("curated mapper is deterministic and refuses to invent unavailable metadata", () => {
    const seed = { key: "example-anime", title: "Example Anime", aliases: ["Example"] };
    const first = mapCuratedSeedToAnime(seed, { rank: 4 });
    const second = mapCuratedSeedToAnime(seed, { rank: 4 });

    assert.equal(first.anilistId, second.anilistId);
    assert.equal(first.metadataSource, "curated");
    assert.equal(first.title.display, "Example Anime");
    assert.equal(first.description, "");
    assert.deepEqual(first.genres, []);
    assert.deepEqual(first.studios, []);
    assert.deepEqual(first.characters, []);
    assert.equal(first.seasonYear, null);
    assert.equal(first.averageScore, null);
    assert.equal(first.malId, null);
});

test("curated aliases participate in duplicate detection", () => {
    const keys = curatedTitleKeys({ title: "Kaiju No. 8", aliases: ["Kaiju No 8"] });
    assert.equal(keys.has("kaiju no 8"), true);
    assert.equal(keys.size, 1, "equivalent alias should collapse after normalization");
});

test("catalogue growth can continue with zero metadata network providers", async () => {
    const [grow, script, pkg] = await Promise.all([
        read("src/scripts/growCatalog.js"),
        read("src/scripts/ingestCuratedAnime.js"),
        read("package.json"),
    ]);

    assert.match(grow, /AniList → Jikan → curated offline → stored/);
    assert.match(grow, /ingestCuratedAnime\.js/);
    assert.match(grow, /youtubeMetadataSource: "curated"/);
    assert.match(script, /No API key and no network request are required/);
    assert.match(pkg, /"ingest:curated"\s*:/);
});

test("AniList and Jikan recovery can reuse curated rows instead of blindly duplicating them", async () => {
    const ingest = await read("src/utils/animeIngest.js");
    assert.match(ingest, /findCuratedTitleMatch/);
    assert.match(ingest, /metadataSource: "curated"/);
    assert.match(ingest, /normalizeCuratedTitle/);
});
