/**
 * Quality-filter tests. Pure logic — no network, no database, no API key.
 *
 *   node tests/youtubeFilter.test.mjs
 *
 * Uses node:test/node:assert from the standard library, so it adds no dependency.
 * Channel names, titles and durations here are real values observed in the live
 * dry run, not invented examples.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
    assessAnimeEntityRelevance,
    assessQuality,
    animeEntityAliases,
    animeRelevanceTokens,
    channelMatchesTerm,
    computeSlots,
    DENYLISTED_VIDEO_IDS,
    evaluateVideo,
    flattenName,
    isAnimeOwnChannel,
    isTrustedChannel,
    matchAnimeTokens,
    MAX_VIDEOS_PER_ANIME,
    titleFingerprint,
} from "../src/utils/youtubeIngest.js";

/** The real Naruto Anime document shape (AniList data, trimmed to what matters). */
const NARUTO = {
    title: {
        english: "Naruto Shippuden",
        romaji: "NARUTO: Shippuuden",
        native: "ナルト- 疾風伝",
        display: "Naruto: Shippuden",
    },
    studios: ["Studio Pierrot"],
};

const ONE_PIECE = {
    title: { english: "ONE PIECE", romaji: "ONE PIECE", native: "ONE PIECE", display: "ONE PIECE" },
    studios: ["Toei Animation"],
};

/** A playable video: passes every availability check, so quality decides. */
const playable = (overrides = {}) => ({
    videoId: "aBcDeFgHiJk",
    title: "Sample",
    description: "",
    channelTitle: "Unknown Uploader",
    duration: 120,
    privacyStatus: "public",
    embeddable: true,
    uploadStatus: "processed",
    liveBroadcastContent: "none",
    publishedAt: "2024-01-01T00:00:00Z",
    ...overrides,
});

/* ========================================================================== *
 * Channel trust — including the self-inflicted regression that marked every
 * channel trusted. These assertions exist because the bug was caught by
 * eyeballing an ACCEPT list, not by a test.
 * ========================================================================== */

test("trusted channel: real spacing variants all normalise to the same term", () => {
    // The channel is literally "vizmedia" on YouTube; the term is "viz media".
    assert.equal(isTrustedChannel("VIZ Media", NARUTO), true, "VIZ Media");
    assert.equal(isTrustedChannel("vizmedia", NARUTO), true, "vizmedia");
    assert.equal(isTrustedChannel("VIZ-Media", NARUTO), true, "VIZ-Media");
    assert.equal(isTrustedChannel("VIZ_Media", NARUTO), true, "VIZ_Media");
    assert.equal(isTrustedChannel("  viz   media  ", NARUTO), true, "extra whitespace");
});

test("trusted channel: Japanese name is not destroyed by normalisation", () => {
    // An ASCII-only strip reduces this to "" and breaks both directions.
    assert.notEqual(flattenName("スタジオぴえろ【公式】"), "", "must not flatten to empty");
    assert.equal(isTrustedChannel("スタジオぴえろ【公式】", NARUTO), true);
    assert.equal(isTrustedChannel("東映アニメーション公式チャンネル", ONE_PIECE), true);
});

test("REGRESSION: an empty normalised channel must never be trusted", () => {
    // `"anything".includes("")` is true, which once marked all 30 candidates
    // trusted and let fabricated live-action fakes score 7 and pass.
    for (const channel of ["", "   ", "!!!", "---", "###", "【】", "😀🔥", null, undefined]) {
        assert.equal(
            isTrustedChannel(channel, NARUTO),
            false,
            `channel ${JSON.stringify(channel)} must not be trusted`
        );
    }
});

test("REGRESSION: a term that flattens to empty must never match", () => {
    assert.equal(channelMatchesTerm("vizmedia", ""), false);
    assert.equal(channelMatchesTerm("vizmedia", "   "), false);
    assert.equal(channelMatchesTerm("vizmedia", "【】"), false);
    // And an empty channel must not match a real term.
    assert.equal(channelMatchesTerm("", "crunchyroll"), false);
});

test("trusted channel: an unknown uploader is not trusted", () => {
    for (const channel of ["Unknown Uploader", "Anime Concepts HD", "Naruto Fan Zone", "Trailer World"]) {
        assert.equal(isTrustedChannel(channel, NARUTO), false, channel);
    }
});

test("trusted channel: per-anime studios come from real AniList data", () => {
    // Same code path serves any series — no Naruto-only hard-coding.
    const jjk = { title: { display: "Jujutsu Kaisen" }, studios: ["MAPPA"] };
    assert.equal(isTrustedChannel("MAPPA CHANNEL", jjk), true);
    const aot = { title: { display: "Attack on Titan" }, studios: ["Wit Studio"] };
    assert.equal(isTrustedChannel("WIT STUDIO", aot), true);
});

test("trusted channel: the series' own official account is trusted", () => {
    // Real channel from the 10-anime dry run, which wrongly rejected three of its
    // genuine opening videos because it matches no studio and no distributor.
    assert.equal(isAnimeOwnChannel("ONE PIECE公式YouTubeチャンネル", ONE_PIECE), true);
    assert.equal(isAnimeOwnChannel("ONE PIECE Official - ENG", ONE_PIECE), true);
    assert.equal(isTrustedChannel("ONE PIECE公式YouTubeチャンネル", ONE_PIECE), false, "not a distributor");
});

test("own channel: needs BOTH the title and an official marker", () => {
    // A fan channel naming the anime must not become trusted.
    assert.equal(isAnimeOwnChannel("Naruto Fan Zone", NARUTO), false, "no official marker");
    assert.equal(isAnimeOwnChannel("Naruto Clips HD", NARUTO), false, "no official marker");
    // A generic "official" channel not tied to this anime must not either.
    assert.equal(isAnimeOwnChannel("Official Trailer Hub", NARUTO), false, "no anime title");
    assert.equal(isAnimeOwnChannel("Anime Official", NARUTO), false, "generic only");
    // Cross-series: One Piece's account is not trusted for Naruto.
    assert.equal(isAnimeOwnChannel("ONE PIECE公式YouTubeチャンネル", NARUTO), false);
});

test("own channel: a Japanese-titled opening from the series' account is accepted", () => {
    const verdict = assessQuality(
        playable({
            title: "＜オープニング映像フル＞TVアニメ「ONE PIECE」／オープニングテーマ「あーーっす！」歌：きただにひろし",
            channelTitle: "ONE PIECE公式YouTubeチャンネル",
            duration: 91,
        }),
        { anime: ONE_PIECE }
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

test("own channel: relevance may come from the channel when the title omits the name", () => {
    const verdict = assessQuality(
        playable({ title: "Opening Theme | We Are! | Hiroshi Kitadani", channelTitle: "ONE PIECE Official - ENG", duration: 111 }),
        { anime: ONE_PIECE }
    );
    assert.equal(verdict.ok, true, verdict.reason);

    // The same title from an unknown uploader stays off-topic.
    const unknown = assessQuality(
        playable({ title: "Opening Theme | We Are! | Hiroshi Kitadani", channelTitle: "Anime Songs HD", duration: 111 }),
        { anime: ONE_PIECE }
    );
    assert.equal(unknown.ok, false);
});

/* ========================================================================== *
 * Relevance
 * ========================================================================== */

test("relevance: title variants all match, not just title.display", () => {
    for (const title of [
        "Naruto Shippuden",
        "Naruto: Shippuden",
        "NARUTO",
        "Naruto Opening 1",
        "NARUTO -ナルト- 疾風伝 予告",
        "naruto shippuden official trailer",
    ]) {
        const { matched } = matchAnimeTokens(title, NARUTO);
        assert.ok(matched.length > 0, `"${title}" should be relevant`);
    }
});

test("relevance: an unrelated title is rejected as off-topic", () => {
    const verdict = assessQuality(playable({ title: "Bleach Official Trailer" }), { anime: NARUTO });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /anime entity mismatch/);
});

test("relevance: generic tokens alone are not sufficient", () => {
    // "ONE PIECE" must not make every title containing "one" relevant.
    const tokens = animeRelevanceTokens(ONE_PIECE);
    assert.equal(tokens.distinctive.includes("one"), false, '"one" must be treated as generic');
    assert.ok(tokens.distinctive.includes("piece"), '"piece" is distinctive');

    const { matched } = matchAnimeTokens("Number One Trailer 2024", ONE_PIECE);
    assert.equal(matched.length, 0, '"one" alone must not establish relevance');

    const real = matchAnimeTokens("ONE PIECE Official Trailer", ONE_PIECE);
    assert.ok(real.matched.length > 0, "the real title still matches");
});

test("relevance: a title made only of common words still matches as a phrase", () => {
    const yourName = {
        title: { english: "Your Name.", romaji: "Kimi no Na wa.", native: "君の名は。", display: "Your Name." },
        studios: [],
    };
    assert.ok(matchAnimeTokens("Your Name Official Trailer", yourName).matched.length > 0);
    assert.equal(matchAnimeTokens("Name That Trailer", yourName).matched.length, 0);
});


test("REGRESSION: D.Gray-man must not accept The Gray Man from a trusted Netflix channel", () => {
    const dGrayMan = {
        title: {
            english: "D.Gray-man",
            romaji: "D.Gray-man",
            native: "ディー・グレイマン",
            display: "D.Gray-man",
        },
        studios: [],
    };

    const verdict = assessQuality(
        playable({
            title: "THE GRAY MAN | Official Trailer | Netflix",
            channelTitle: "Netflix",
            description: "Ryan Gosling, Chris Evans and Ana de Armas star in The Gray Man.",
        }),
        { anime: dGrayMan }
    );

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /anime entity collision/i);
});

test("entity identity: D.Gray-man punctuation and native-script titles still match", () => {
    const dGrayMan = {
        title: {
            english: "D.Gray-man",
            romaji: "D.Gray-man",
            native: "ディー・グレイマン",
            display: "D.Gray-man",
        },
        studios: [],
    };

    for (const title of [
        "D.Gray-man HALLOW Official PV",
        "D Gray Man Hallow Trailer",
        "ディー・グレイマン HALLOW PV",
    ]) {
        const match = assessAnimeEntityRelevance({ title, channelTitle: "Unknown" }, dGrayMan);
        assert.equal(match.ok, true, `${title} should identify D.Gray-man`);
    }
});

test("entity identity: reviewed abbreviations work without fuzzy title guessing", () => {
    const attackOnTitan = {
        title: {
            english: "Attack on Titan",
            romaji: "Shingeki no Kyojin",
            native: "進撃の巨人",
            display: "Attack on Titan",
        },
        studios: [],
    };

    const aliases = animeEntityAliases(attackOnTitan).map((row) => row.normalized);
    assert.ok(aliases.includes("aot"));
    const verdict = assessAnimeEntityRelevance(
        { title: "AOT Final Season Official Trailer", channelTitle: "Unknown" },
        attackOnTitan
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

test("entity identity: overlapping title words do not create a cross-anime association", () => {
    const blackClover = {
        title: { english: "Black Clover", romaji: "Black Clover", native: "ブラッククローバー", display: "Black Clover" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "Black Butler Official Trailer", channelTitle: "Crunchyroll" },
        blackClover
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /anime entity mismatch/i);
});

test("REGRESSION: Death Note anime still rejects trusted live-action trailers", () => {
    const deathNote = {
        title: { english: "Death Note", romaji: "Death Note", native: "DEATH NOTE", display: "Death Note" },
        studios: [],
    };
    const verdict = assessQuality(
        playable({
            title: "DEATH NOTE Official Trailer (2017) Nat Wolff | Netflix",
            channelTitle: "Netflix",
        }),
        { anime: deathNote }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /live-action|casting/i);
});


test("REGRESSION: release-year qualifiers do not make Hunter x Hunter official titles ambiguous", () => {
    const hunter = {
        title: {
            english: "Hunter x Hunter (2011)",
            romaji: "Hunter x Hunter (2011)",
            native: "HUNTER×HUNTER",
            display: "Hunter x Hunter (2011)",
        },
        studios: [],
    };

    for (const title of [
        "Hunter X Hunter - Opening 1 | Departure!",
        "Hunter x Hunter: The Last Mission - Official Theatrical Trailer",
        "Hunter X Hunter Set 1- Official Extended Trailer",
    ]) {
        const verdict = assessAnimeEntityRelevance({ title, channelTitle: "VIZ Media" }, hunter);
        assert.equal(verdict.ok, true, `${title} should identify Hunter x Hunter despite the catalogue year qualifier`);
    }

    const aliases = animeEntityAliases(hunter).map((row) => row.normalized);
    assert.ok(aliases.includes("hunter x hunter"));
    assert.ok(aliases.includes("hxh"));
});

test("REGRESSION: Tokyo Ghoul supports native title and one-token human typo", () => {
    const tokyoGhoul = {
        title: {
            english: "Tokyo Ghoul",
            romaji: "Tokyo Ghoul",
            native: "東京喰種",
            display: "Tokyo Ghoul",
        },
        studios: [],
    };

    const native = assessAnimeEntityRelevance(
        { title: "「unravel」×『東京喰種』TV Animation 10th Anniversary Collaboration MV", channelTitle: "Official" },
        tokyoGhoul
    );
    assert.equal(native.ok, true, native.reason);

    const typo = assessAnimeEntityRelevance(
        { title: "Katharsis - Toyko Ghoul | Prime Video", channelTitle: "Prime Video" },
        tokyoGhoul
    );
    assert.equal(typo.ok, true, typo.reason);
});

test("REGRESSION: Tokyo Ghoul does not accept Netflix's unrelated Ghoul trailer", () => {
    const tokyoGhoul = {
        title: { english: "Tokyo Ghoul", romaji: "Tokyo Ghoul", native: "東京喰種", display: "Tokyo Ghoul" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "Ghoul | Official Trailer [HD] | Netflix", channelTitle: "Netflix" },
        tokyoGhoul
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
    assert.match(verdict.reason, /entity collision/i);
});

test("REGRESSION: The Promised Neverland rejects unrelated Neverland films", () => {
    const promisedNeverland = {
        title: {
            english: "The Promised Neverland",
            romaji: "Yakusoku no Neverland",
            native: "約束のネバーランド",
            display: "The Promised Neverland",
        },
        studios: [],
    };

    for (const title of [
        "Finding Neverland | Official Trailer (HD) - Johnny Depp, Kate Winslet | MIRAMAX",
        "Peter Pan's Neverland Nightmare - Official Trailer (2025)",
    ]) {
        const verdict = assessAnimeEntityRelevance({ title, channelTitle: "Official Movies" }, promisedNeverland);
        assert.equal(verdict.ok, false, title);
        assert.equal(verdict.safeToQuarantine, true, title);
        assert.match(verdict.reason, /entity collision/i);
    }
});

test("observed licensed title shorthand: Full Alchemist Brotherhood maps to Fullmetal Alchemist Brotherhood", () => {
    const fmab = {
        title: {
            english: "Fullmetal Alchemist: Brotherhood",
            romaji: "Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST",
            native: "鋼の錬金術師 FULLMETAL ALCHEMIST",
            display: "Fullmetal Alchemist: Brotherhood",
        },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "Full Alchemist: Brotherhood - Trailer (English Dub)", channelTitle: "Official" },
        fmab
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

/* ========================================================================== *
 * Hard rejects
 * ========================================================================== */

const rejects = [
    ["concept trailer", "Naruto Live Action Concept Trailer", /fabricated/],
    ["fan-made", "Naruto Fan Made Trailer 2025", /fabricated/],
    ["fanmade", "Naruto Shippuden fanmade opening", /fabricated/],
    ["AI generated", "Naruto AI Generated Trailer", /fabricated/],
    ["made with AI", "I Made Naruto With AI", /fabricated/],
    ["what if", "What If Naruto Was Real - Trailer", /fabricated/],
    ["deepfake", "Naruto Deepfake Trailer", /fabricated/],
    ["parody", "Naruto Trailer Parody", /fabricated/],
    ["reaction", "Naruto Trailer Reaction", /reaction\/recap/],
    ["explained", "Naruto Ending Explained", /reaction\/recap/],
    ["top N", "Top 10 Naruto Openings", /reaction\/recap/],
    ["tier list", "Naruto Character Tier List", /reaction\/recap/],
    ["AMV", "Naruto AMV - Opening", /fan edit/],
    ["edit", "Naruto Edit - Opening Theme", /fan edit/],
    ["twixtor", "Naruto Twixtor Clips Opening", /fan edit/],
    ["raw clips", "Naruto Raw Clips 4K Opening", /fan edit/],
    ["free fire", "Naruto x Free Fire Official Trailer", /crossover/],
    ["fortnite", "Naruto Fortnite Trailer", /crossover/],
    ["pubg", "Naruto PUBG Mobile Trailer", /crossover/],
];

for (const [label, title, reasonRe] of rejects) {
    test(`hard reject: ${label}`, () => {
        const verdict = assessQuality(playable({ title }), { anime: NARUTO });
        assert.equal(verdict.ok, false, `"${title}" must be rejected`);
        assert.match(verdict.reason, reasonRe);
    });
}

/**
 * These four all scored 5-6 and passed quality in the real 5-query dry run — only
 * the ranking cut kept them out, which would have failed at a higher --per-anime.
 * Real titles and channels from that run.
 */
test("leak: game promo is rejected even from a real official channel", () => {
    const verdict = assessQuality(
        playable({
            title: "NARUTO SHIPPUDEN: Ultimate Ninja STORM 4 Gameplay Trailer | PS4",
            channelTitle: "PlayStation",
            duration: 65,
        }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /video-game promo/);
});

test("leak: a comedy channel's 'Official Fake Trailer' is rejected", () => {
    const verdict = assessQuality(
        playable({ title: "Naruto The Movie! (Official Fake Trailer)", channelTitle: "nigahiga", duration: 196 }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /fabricated/);
});

test("leak: unverifiable 'NEW OFFICIAL ... REVEAL' from an untrusted channel", () => {
    const verdict = assessQuality(
        playable({
            title: "(2026) NEW OFFICIAL NARUTO ANIMATION REVEAL! - Naruto x Hinata - Official Trailer",
            channelTitle: "NechiKage",
            duration: 117,
        }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /unverifiable "official" claim/);
});

test("leak: fan lyric reupload and unlicensed OP/ED reupload", () => {
    const lyrics = assessQuality(
        playable({
            title: "KANA-BOON -「Silhouette」 (Naruto Shippuuden Opening Theme #16 - Full Ver.) [KAN/ROM/ENG Lyrics]",
            channelTitle: "Pop Vibes",
            duration: 239,
        }),
        { anime: NARUTO }
    );
    assert.equal(lyrics.ok, false);
    assert.match(lyrics.reason, /lyric|opening\/ending reupload/);

    const reupload = assessQuality(
        playable({ title: "Naruto Ending 4", channelTitle: "NarutosRasengan", duration: 104 }),
        { anime: NARUTO }
    );
    assert.equal(reupload.ok, false);
    assert.match(reupload.reason, /opening\/ending reupload/);
});

test("the OP/ED rule does not touch licensed channels", () => {
    // Crunchyroll and VIZ openings are the bulk of the legitimate accept list.
    const cr = assessQuality(
        playable({ title: "Naruto Shippuden Opening 16 | Silhouette by KANA-BOON", channelTitle: "Crunchyroll", duration: 100 }),
        { anime: NARUTO }
    );
    assert.equal(cr.ok, true, cr.reason);

    const viz = assessQuality(
        playable({ title: "Naruto | Opening 2 - Haruka Kanata | VIZ", channelTitle: "vizmedia", duration: 95 }),
        { anime: NARUTO }
    );
    assert.equal(viz.ok, true, viz.reason);
});

test("hard reject: redistribution signal in the description", () => {
    const verdict = assessQuality(
        playable({ title: "Naruto Shippuden Trailer", description: "Join our telegram for full episodes" }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /redistribution/);
});

test("hard reject: shorts bait and hashtag stuffing", () => {
    const shorts = assessQuality(playable({ title: "Naruto opening #shorts" }), { anime: NARUTO });
    assert.equal(shorts.ok, false);
    assert.match(shorts.reason, /shorts\/engagement bait/);

    const stuffed = assessQuality(
        playable({ title: "Naruto trailer #naruto #anime #edits #fyp" }),
        { anime: NARUTO }
    );
    assert.equal(stuffed.ok, false);
});

test("hashtag stuffing: a trusted channel is exempt", () => {
    const verdict = assessQuality(
        playable({
            title: "NARUTO 20th Anniversary PV #NARUTO #ナルト #ぴえろ",
            channelTitle: "スタジオぴえろ【公式】",
            duration: 180,
        }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

test("word boundary: 'Edition' and 'Editing' are not fan edits", () => {
    const edition = assessQuality(
        playable({ title: "Naruto Shippuden Trailer - Special Edition", channelTitle: "vizmedia" }),
        { anime: NARUTO }
    );
    assert.equal(edition.ok, true, edition.reason);

    const editing = assessQuality(
        playable({ title: "Naruto Shippuden Opening - Remastered Editing Notes", channelTitle: "vizmedia" }),
        { anime: NARUTO }
    );
    assert.equal(editing.ok, true, editing.reason);
});

/* ========================================================================== *
 * Context-dependent rules
 * ========================================================================== */

/**
 * BEHAVIOUR CHANGE, made deliberately after the real 30-50 import.
 *
 * Live action was previously context-dependent: rejected from untrusted channels,
 * allowed from trusted ones. The real import showed that allowance is what caused
 * the damage — Netflix, Madman Films and Crunchyroll Store Australia are all
 * genuinely licensed, and they are precisely who uploads live-action film
 * trailers. Four of six Death Note videos ended up being live-action films filed
 * under the Death Note *anime* document.
 *
 * A live-action adaptation is a different production, so it is now rejected
 * regardless of uploader. Untrusted live-action claims are still rejected too;
 * only the reason string differs.
 */
test("live action: rejected from untrusted AND trusted channels", () => {
    const untrusted = assessQuality(
        playable({ title: "Naruto Live Action Trailer", channelTitle: "Fake Trailers HD" }),
        { anime: NARUTO }
    );
    assert.equal(untrusted.ok, false);
    assert.match(untrusted.reason, /live-action/);

    const trusted = assessQuality(
        playable({ title: "Naruto Live Action Official Teaser", channelTitle: "vizmedia", duration: 90 }),
        { anime: NARUTO }
    );
    assert.equal(trusted.ok, false, "a licensed channel's live-action trailer is still not the anime");
    assert.match(trusted.reason, /live-action adaptation/);
});

test("Hollywood casting: only rejected when the source is untrusted", () => {
    const fake = assessQuality(
        playable({ title: "Naruto Trailer with Tom Holland", channelTitle: "Concept Trailers" }),
        { anime: NARUTO }
    );
    assert.equal(fake.ok, false);
    assert.match(fake.reason, /Hollywood casting/);

    const official = assessQuality(
        playable({ title: "Naruto Teaser featuring Tom Holland", channelTitle: "Netflix", duration: 100 }),
        { anime: NARUTO }
    );
    assert.equal(official.ok, true, official.reason);
});

/* ========================================================================== *
 * Live-action adaptations — a different production from the anime.
 * All titles/channels below are real, from the 30-50 import audit.
 * ========================================================================== */

test("live-action adaptation is rejected even from a licensed channel", () => {
    // Crunchyroll Store Australia genuinely uploaded this; trust is not the issue.
    const aot = assessQuality(
        playable({
            title: "Attack on Titan (Live Action Movie) - Official Theatrical Trailer",
            channelTitle: "Crunchyroll Store Australia",
            duration: 194,
        }),
        { anime: { title: { display: "Attack on Titan", english: "Attack on Titan" }, studios: ["Wit Studio"], format: "TV" } }
    );
    assert.equal(aot.ok, false);
    assert.match(aot.reason, /live-action adaptation/);
});

test("live-action film cast in the title is rejected", () => {
    const dn = { title: { display: "Death Note", english: "Death Note", romaji: "Death Note" }, studios: ["Madhouse"], format: "TV" };
    const verdict = assessQuality(
        playable({
            title: "DEATH NOTE Official Trailer (2017) Nat Wolff, Netflix Thriller Movie HD",
            channelTitle: "ONE Media",
            duration: 66,
        }),
        { anime: dn }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /live-action adaptation/);
});

test("the live-action rule does not reject the actual anime trailer", () => {
    const dn = { title: { display: "Death Note", english: "Death Note", romaji: "Death Note" }, studios: ["Madhouse"], format: "TV" };
    const verdict = assessQuality(
        playable({ title: "Death Note (Anime-Trailer)", channelTitle: "Crunchyroll Extras Deutschland", duration: 88 }),
        { anime: dn }
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

/* ========================================================================== *
 * Same-title-different-id duplicates
 * ========================================================================== */

test("titleFingerprint collapses cross-posted duplicates", () => {
    // Real case: the same 137s trailer on two Netflix-operated channels.
    assert.equal(
        titleFingerprint("Death Note | Official Trailer [HD] | Netflix"),
        titleFingerprint("Death Note | Official Trailer | Netflix")
    );
    // Quality/format noise must not make two copies look different.
    assert.equal(
        titleFingerprint("BLEACH TYBW - Official Trailer #1 (4K60fps)"),
        titleFingerprint("BLEACH TYBW - Trailer #1")
    );
});

test("titleFingerprint keeps genuinely different videos distinct", () => {
    assert.notEqual(
        titleFingerprint("Attack on Titan Opening 1 | Feuerroter Pfeil und Bogen"),
        titleFingerprint("Attack on Titan Opening 2 | Jiyuu no Tsubasa by Linked Horizon")
    );
    assert.notEqual(
        titleFingerprint("My Hero Academia Season 7 | OFFICIAL TRAILER"),
        titleFingerprint("My Hero Academia FINAL SEASON | English Dub Trailer | Crunchyroll")
    );
    assert.notEqual(titleFingerprint("Naruto Opening 1"), titleFingerprint("Naruto Ending 1"));

    /**
     * Real false positive caught during the import audit: stripping every bracketed
     * group merged two genuinely different Aniplex USA trailers — a 57s dub-cast
     * announcement and an 85s Mount Natagumo arc trailer. Meaningful parentheses
     * must survive; only pure quality/year noise is dropped.
     */
    assert.notEqual(
        titleFingerprint("Demon Slayer: Kimetsu no Yaiba Official English Dub Trailer"),
        titleFingerprint("Demon Slayer: Kimetsu no Yaiba - English Dub Trailer (Mount Natagumo)")
    );
});

/* ========================================================================== *
 * Duration
 * ========================================================================== */

test("duration: bounds are 10-900s untrusted, 10-2400s trusted", () => {
    const short = assessQuality(
        playable({ title: "Naruto Trailer", duration: 8 }), { anime: NARUTO });
    assert.equal(short.ok, false);
    assert.match(short.reason, /too short/);

    const longUntrusted = assessQuality(
        playable({ title: "Naruto Trailer", duration: 1200 }), { anime: NARUTO });
    assert.equal(longUntrusted.ok, false);
    assert.match(longUntrusted.reason, /too long/);

    // Crunchyroll's real 1800s official opening collection.
    const longTrusted = assessQuality(
        playable({ title: "Naruto Openings Collection", channelTitle: "Crunchyroll Collection", duration: 1800 }),
        { anime: NARUTO }
    );
    assert.equal(longTrusted.ok, true, longTrusted.reason);

    const tooLongEvenTrusted = assessQuality(
        playable({ title: "Naruto Openings", channelTitle: "Crunchyroll", duration: 5000 }),
        { anime: NARUTO }
    );
    assert.equal(tooLongEvenTrusted.ok, false);
});

test("duration: 0, negative and null are never accepted", () => {
    for (const duration of [0, -5, null, undefined, NaN]) {
        const verdict = assessQuality(
            playable({ title: "Naruto Official Trailer", channelTitle: "vizmedia", duration }),
            { anime: NARUTO }
        );
        assert.equal(verdict.ok, false, `duration ${duration} must be rejected`);
    }
});

/* ========================================================================== *
 * Scoring and the promo requirement
 * ========================================================================== */

test("score: a real VIZ Media trailer scores high", () => {
    const verdict = assessQuality(
        playable({
            title: "Naruto Shippuden Official Trailer",
            channelTitle: "vizmedia",
            duration: 120,
        }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, true, verdict.reason);
    assert.ok(verdict.score >= 10, `expected a high score, got ${verdict.score}`);
    assert.ok(verdict.signals.includes("+5 trusted channel"));
});

test("requirement: untrusted channel with no promo keyword is rejected regardless of score", () => {
    // The real leak: this scored 3 and passed on "+2 title match, +1 promo-length".
    const verdict = assessQuality(
        playable({ title: "Naruto Saves His Wife from Toneri Ōtsutsuki ❤️🔥", duration: 120 }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /untrusted channel and no promotional keyword/);

    // And it stays rejected even if the score threshold is lowered to nothing —
    // it is a hard requirement, not a score tweak.
    const zeroThreshold = assessQuality(
        playable({ title: "Naruto Saves His Wife from Toneri Ōtsutsuki ❤️🔥", duration: 120 }),
        { anime: NARUTO, minScore: 0 }
    );
    assert.equal(zeroThreshold.ok, false);
});

test("score: minimum threshold is enforced", () => {
    const verdict = assessQuality(
        playable({ title: "Naruto Trailer", duration: 800 }), // untrusted, promo, no length bonus
        { anime: NARUTO, minScore: 99 }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /quality score/);
});

/* ========================================================================== *
 * Availability still runs first, and still runs at all
 * ========================================================================== */

test("availability: every original check still fires before quality", () => {
    const cases = [
        [{ videoId: null }, /no videoId/],
        [{ videoId: "short" }, /malformed videoId/],
        [{ title: "" }, /unavailable/],
        [{ privacyStatus: "private" }, /not public/],
        [{ embeddable: false }, /not embeddable/],
        [{ uploadStatus: "rejected" }, /upload status/],
        [{ duration: null }, /duration unavailable/],
        [{ liveBroadcastContent: "live" }, /live content/],
        [{ title: "Naruto Full Episode 1" }, /blocked term/],
    ];
    for (const [overrides, reasonRe] of cases) {
        const verdict = evaluateVideo(
            playable({ title: "Naruto Official Trailer", channelTitle: "vizmedia", ...overrides }),
            { anime: NARUTO }
        );
        assert.equal(verdict.ok, false, `${JSON.stringify(overrides)} must be rejected`);
        assert.match(verdict.reason, reasonRe);
    }
});

test("availability: a fabricated video is rejected even when perfectly playable", () => {
    const verdict = evaluateVideo(
        playable({ title: "Naruto Live Action Concept Trailer", channelTitle: "Concept Central" }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /fabricated/);
});

test("dedupe: existing and in-run ids are still rejected", () => {
    const good = playable({ title: "Naruto Official Trailer", channelTitle: "vizmedia" });
    assert.equal(evaluateVideo(good, { anime: NARUTO }).ok, true);

    const existing = evaluateVideo(good, { anime: NARUTO, existingIds: new Set([good.videoId]) });
    assert.match(existing.reason, /already exists/);

    const seen = evaluateVideo(good, { anime: NARUTO, seenIds: new Set([good.videoId]) });
    assert.match(seen.reason, /duplicate in this run/);
});

test("evaluateVideo without an anime still applies non-relevance rules", () => {
    assert.equal(evaluateVideo(playable({ title: "Some Concept Trailer" }), {}).ok, false);
    // Relevance self-disables rather than rejecting everything.
    assert.equal(evaluateVideo(playable({ title: "Official Trailer", channelTitle: "vizmedia" }), {}).ok, true);
});

/* ========================================================================== *
 * Reviewed-id denylist.
 *
 * The escape hatch for content with no detectable signal: two live-action Death
 * Note films whose titles are indistinguishable from an anime trailer, one of
 * them from a genuinely licensed distributor (Madman Films). These tests pin the
 * two properties that make the mechanism safe — it outranks every heuristic, and
 * it affects nothing else.
 * ========================================================================== */

test("denylist: a reviewed id is rejected even with a perfect title and trusted channel", () => {
    // Real record: Madman Films is licensed, the title reads as an anime trailer.
    const verdict = evaluateVideo(
        playable({
            videoId: "XBLJ18gcOjY",
            title: "Death Note: Light Up The New World - Official Trailer",
            channelTitle: "Madman Films",
        }),
        { anime: { title: { display: "Death Note", english: "Death Note", romaji: "Death Note" } } }
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /denylisted after review/);
});

test("denylist: rejection outranks trust, score and every quality rule", () => {
    // Same id, dressed up as the single strongest candidate the scorer can see.
    const verdict = evaluateVideo(
        playable({
            videoId: "mdZQ-_GLzYs",
            title: "Death Note Official Trailer",
            channelTitle: "Crunchyroll",
            duration: 120,
        }),
        { anime: { title: { display: "Death Note", english: "Death Note", romaji: "Death Note" } } }
    );
    assert.equal(verdict.ok, false, "no score or trust level may readmit a reviewed id");
    assert.match(verdict.reason, /denylisted/);
});

test("denylist: does not affect ids that are not on it", () => {
    const verdict = evaluateVideo(
        playable({ videoId: "aBcDeFgHiJk", title: "Naruto Official Trailer", channelTitle: "vizmedia" }),
        { anime: NARUTO }
    );
    assert.equal(verdict.ok, true);
});

test("denylist: every entry carries a human-readable reason", () => {
    // An unexplained id cannot be re-audited later, so an empty reason is a bug.
    assert.ok(DENYLISTED_VIDEO_IDS.size > 0);
    for (const [id, reason] of DENYLISTED_VIDEO_IDS) {
        assert.match(id, /^[A-Za-z0-9_-]{11}$/, `"${id}" must be a valid YouTube id`);
        assert.ok(typeof reason === "string" && reason.length > 10, `"${id}" needs a real reason`);
    }
});

/* ========================================================================== *
 * Per-anime slot arithmetic.
 *
 * --per-anime controls how many videos may be added in a single run.
 * MAX_VIDEOS_PER_ANIME is the hard lifetime ceiling for one anime.
 *
 * Tests intentionally derive their boundary cases from
 * MAX_VIDEOS_PER_ANIME so changing the ceiling in the future does not leave
 * stale hard-coded expectations behind.
 * ========================================================================== */

test("slots: default mode keeps the per-run meaning of --per-anime", () => {
    // An anime below the hard ceiling may still receive the requested
    // number of videos for this run.
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: 0,
        }),
        3
    );

    assert.equal(
        computeSlots({
            perAnime: 2,
            existingCount: 1,
        }),
        2
    );
});

test("slots: default mode is bounded by the hard ceiling", () => {
    // Plenty of room remains, so the complete per-run request is allowed.
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: 3,
        }),
        3,
        "full per-run request is allowed when enough headroom remains"
    );

    // Only two positions remain before the hard ceiling.
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: MAX_VIDEOS_PER_ANIME - 2,
        }),
        2,
        "request is clamped to remaining headroom"
    );

    // Already full.
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: MAX_VIDEOS_PER_ANIME,
        }),
        0,
        "full anime must request no additional videos"
    );

    // Defensive case: database state is somehow already beyond the ceiling.
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: MAX_VIDEOS_PER_ANIME + 50,
        }),
        0,
        "slot count must never become negative"
    );
});

test("slots: --total-cap treats --per-anime as the desired total", () => {
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: 0,
            totalCap: true,
        }),
        3
    );

    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: 2,
            totalCap: true,
        }),
        1,
        "tops up only the missing amount"
    );

    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: 3,
            totalCap: true,
        }),
        0,
        "already at requested total"
    );

    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: 6,
            totalCap: true,
        }),
        0,
        "being above the requested total must never create negative slots"
    );
});

test("slots: --total-cap is idempotent", () => {
    const first = computeSlots({
        perAnime: 3,
        existingCount: 0,
        totalCap: true,
    });

    assert.equal(first, 3);

    // After importing those three, running the same command again should
    // request nothing and therefore avoid unnecessary YouTube quota usage.
    assert.equal(
        computeSlots({
            perAnime: 3,
            existingCount: first,
            totalCap: true,
        }),
        0
    );
});

test("slots: --total-cap cannot exceed the hard ceiling", () => {
    assert.equal(
        computeSlots({
            perAnime: MAX_VIDEOS_PER_ANIME + 10,
            existingCount: 0,
            totalCap: true,
        }),
        MAX_VIDEOS_PER_ANIME,
        "a requested total above the hard ceiling must be capped"
    );

    // Also verify the ceiling while some videos already exist.
    assert.equal(
        computeSlots({
            perAnime: MAX_VIDEOS_PER_ANIME + 10,
            existingCount: 5,
            totalCap: true,
        }),
        MAX_VIDEOS_PER_ANIME - 5,
        "only remaining headroom may be imported"
    );
});
/* ========================================================================== *
 * Association matcher refinement v2 — live audit regressions
 * ========================================================================== */

test("REGRESSION: Re:ZERO shorthand still identifies the full catalogue title", () => {
    const anime = {
        title: {
            english: "Re:ZERO -Starting Life in Another World-",
            romaji: "Re:Zero kara Hajimeru Isekai Seikatsu",
            native: "Re：ゼロから始める異世界生活",
            display: "Re:ZERO -Starting Life in Another World-",
        },
        studios: [],
    };
    for (const title of ["Re:ZERO S2 - Opening (HD)", "Re:ZERO (Anime-Trailer)"]) {
        const verdict = assessAnimeEntityRelevance({ title, channelTitle: "Crunchyroll" }, anime);
        assert.equal(verdict.ok, true, `${title} should identify Re:ZERO`);
    }
});

test("REGRESSION: Evangelion franchise titles map to Neon Genesis Evangelion", () => {
    const anime = {
        title: {
            english: "Neon Genesis Evangelion",
            romaji: "Shin Seiki Evangelion",
            native: "新世紀エヴァンゲリオン",
            display: "Neon Genesis Evangelion",
        },
        studios: [],
    };
    for (const title of [
        "THE END OF EVANGELION | Official Trailer",
        "EVANGELION:DEATH (TRUE)² & REBIRTH | Official Trailer",
        "EVANGELION: 3.0+1.01 THRICE UPON A TIME - Official Trailer | Prime Video",
        "Evangelion - New Anime Reveal Trailer",
    ]) {
        const verdict = assessAnimeEntityRelevance({ title, channelTitle: "Prime Video" }, anime);
        assert.equal(verdict.ok, true, `${title} should identify the Evangelion franchise`);
    }
});

test("REGRESSION: Kaguya-sama Japanese franchise title is accepted", () => {
    const anime = {
        title: {
            english: "Kaguya-sama: Love is War",
            romaji: "Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen",
            native: "かぐや様は告らせたい～天才たちの恋愛頭脳戦～",
            display: "Kaguya-sama: Love is War",
        },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "TVアニメ「かぐや様は告らせたい-ファーストキッスは終わらない-」ノンクレジットオープニング映像", channelTitle: "Aniplex" },
        anime
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

test("REGRESSION: Anohana long Japanese romanized title maps to Anohana", () => {
    const anime = {
        title: {
            english: "Anohana: The Flower We Saw That Day",
            romaji: "Ano Hi Mita Hana no Namae wo Bokutachi wa Mada Shiranai.",
            native: "あの日見た花の名前を僕達はまだ知らない。",
            display: "Anohana: The Flower We Saw That Day",
        },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "[Trailer] Ano Hi Mita Hana no Namae o Bokutachi wa Mada Shiranai [Sub Esp]", channelTitle: "Unknown" },
        anime
    );
    assert.equal(verdict.ok, true, verdict.reason);
});

test("REGRESSION: Assassination Classroom rejects Classroom of the Elite", () => {
    const anime = {
        title: { english: "Assassination Classroom", romaji: "Ansatsu Kyoushitsu", native: "暗殺教室", display: "Assassination Classroom" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "Classroom of the elite | HINDI DUB | official teaser", channelTitle: "Unknown" },
        anime
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
    assert.match(verdict.reason, /Classroom of the Elite/i);
});

test("REGRESSION: Chainsaw Man rejects Texas Chainsaw Massacre", () => {
    const anime = {
        title: { english: "Chainsaw Man", romaji: "Chainsaw Man", native: "チェンソーマン", display: "Chainsaw Man" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "TEXAS CHAINSAW MASSACRE | Official Trailer | Netflix", channelTitle: "Netflix" },
        anime
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
});

test("REGRESSION: Spirited Away rejects Apple's Spirited movie trailer", () => {
    const anime = {
        title: { english: "Spirited Away", romaji: "Sen to Chihiro no Kamikakushi", native: "千と千尋の神隠し", display: "Spirited Away" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "Spirited — Official Trailer | Apple TV", channelTitle: "Apple TV" },
        anime
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
});


test("REGRESSION: legitimate Spirited Away titles are never mistaken for Apple's Spirited", () => {
    const anime = {
        title: { english: "Spirited Away", romaji: "Sen to Chihiro no Kamikakushi", native: "千と千尋の神隠し", display: "Spirited Away" },
        studios: [],
    };

    for (const title of [
        "SPIRITED AWAY | Official English Trailer",
        "Spirited Away 15th Anniversary Limited Edition - Official Trailer",
        "Spirited Away - Celebrate Studio Ghibli - Official Trailer",
        "SPIRITED AWAY: Live On Stage Trailer",
        "Spirited Away - Studio Ghibli Fest 2019 Trailer [In Theaters October 2019]",
        "SPIRITED AWAY | Vintage Trailer (2001)",
        "Spirited Away | Official Trailer | Now Available On Digital and On-Demand",
    ]) {
        const verdict = assessAnimeEntityRelevance({ title, channelTitle: "Unknown" }, anime);
        assert.notEqual(verdict.status, "collision", `${title} must not be classified as the separate movie Spirited`);
        assert.equal(verdict.ok, true, `${title} should identify Spirited Away`);
    }
});

test("REGRESSION: My Dress-Up Darling rejects DARLING in the FRANXX", () => {
    const anime = {
        title: { english: "My Dress-Up Darling", romaji: "Sono Bisque Doll wa Koi wo Suru", native: "その着せ替え人形は恋をする", display: "My Dress-Up Darling" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "DARLING in the FRANXX - Opening (HD)", channelTitle: "Unknown" },
        anime
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
});

test("REGRESSION: Made in Abyss rejects Kaiju No. 8", () => {
    const anime = {
        title: { english: "Made in Abyss", romaji: "Made in Abyss", native: "メイドインアビス", display: "Made in Abyss" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "アニメ『怪獣８号』ノンクレジットOP｜YUNGBLUD『Abyss』", channelTitle: "TOHO animation" },
        anime
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
});

test("REGRESSION: Samurai Champloo rejects Blue Eye Samurai", () => {
    const anime = {
        title: { english: "Samurai Champloo", romaji: "Samurai Champloo", native: "サムライチャンプルー", display: "Samurai Champloo" },
        studios: [],
    };
    const verdict = assessAnimeEntityRelevance(
        { title: "Blue Eye Samurai: Season 2 | Official Teaser | Netflix", channelTitle: "Netflix" },
        anime
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.safeToQuarantine, true);
});
