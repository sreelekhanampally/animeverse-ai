import mongoose from "mongoose";
import { Video } from "../models/video.model.js";
import { Anime } from "../models/anime.model.js";
import { User } from "../models/user.model.js";
import {
    getVideoDetails,
    isValidYouTubeId,
    normaliseVideoItem,
    searchVideos,
    YouTubeQuotaError,
} from "../services/youtube.service.js";

/**
 * YouTube ingestion.
 *
 * Discovers real anime-related videos through the official Data API and creates
 * Video documents that carry only the 11-character YouTube ID. Nothing is
 * downloaded, no stream URL is stored, no media reaches Cloudinary — playback is
 * handled entirely by the existing Phase 1 YouTube embed.
 *
 * Split from the service (which only talks to Google) and the CLI (which only
 * parses argv and prints), so the same logic could later run from a job.
 */

/**
 * Query templates, applied per anime title.
 *
 * Deliberately biased toward official promotional material. The brief's excluded
 * patterns ("full episode", "watch full anime", "episode download", "free full
 * episodes") are absent by design — we never go looking for pirated uploads, and
 * the blocked-term filter is a second line of defence for when a search returns
 * one anyway.
 *
 * Order matters: the first templates are the highest-signal, and --per-anime
 * truncates from the end, so a conservative run still gets trailers first.
 */
export const QUERY_TEMPLATES = [
    (title) => `${title} official trailer`,
    (title) => `${title} opening`,
    (title) => `${title} official clip`,
    (title) => `${title} trailer`,
    (title) => `${title} ending`,
];

/**
 * Small, targeted blocked-term list — not an aggressive blacklist.
 *
 * Each entry targets piracy/full-episode uploads specifically. Kept short on
 * purpose: broad words like "episode" or "full" would reject legitimate material
 * ("Episode 1 Preview", "Full Trailer", "Full Opening"), which the brief warns
 * against.
 */
export const BLOCKED_TERMS = [
    "full episode",
    "full episodes",
    "watch full",
    "episode 1 full",
    "episode 2 full",
    "download anime",
    "free anime download",
    "eng sub full",
    "full movie",
];

/**
 * The system account that owns imported videos.
 *
 * Required, not optional: Channel pages resolve by `username`, the Dashboard and
 * `getAllVideos?userId=` filter by `owner`, and the owner `$lookup` + `$first`
 * in every video pipeline yields null without one — so ownerless videos would
 * render with no creator anywhere in the UI.
 *
 * Assigning them to a real user instead would be wrong: their Dashboard stats and
 * subscriber-facing channel would silently absorb content they never uploaded.
 * Authorization is untouched — this account owns the videos outright, so the
 * existing "is this your video?" checks keep working unchanged.
 */
export const INGESTION_OWNER = {
    username: "animeverse_official",
    email: "official@animeverse.local",
    fullName: "AnimeVerse Official",
    // Neutral placeholder; `avatar` is required by the User schema. Not a real
    // person's likeness and not fetched from anywhere.
    avatar: "https://ui-avatars.com/api/?name=AnimeVerse&background=6d28d9&color=fff&size=256",
};

/**
 * Idempotent: created once, then reused. The unique index on `username` makes the
 * upsert atomic, so two concurrent runs cannot both create it.
 *
 * The password is a throwaway random value that is never printed or stored
 * anywhere else — this account exists to own documents, not to be logged into.
 * It is deliberately NOT derived from an env secret, so nobody can guess it.
 */
export async function ensureIngestionOwner() {
    const existing = await User.findOne({ username: INGESTION_OWNER.username }).select("_id username");
    if (existing) return { user: existing, created: false };

    const user = await User.create({
        ...INGESTION_OWNER,
        password: `${new mongoose.Types.ObjectId().toString()}${Math.random().toString(36).slice(2)}${Date.now()}`,
    });

    return { user, created: true };
}

const containsBlockedTerm = (text) => {
    const haystack = String(text || "").toLowerCase();
    return BLOCKED_TERMS.find((term) => haystack.includes(term)) || null;
};

/* ========================================================================== *
 * QUALITY FILTER
 *
 * Availability (above) answers "can this play?". Quality answers "is this the
 * real anime work?". They are separate on purpose: every one of the four bad
 * Naruto imports was public, embeddable, non-live and ~2 minutes long, so it
 * satisfied every availability check while being a concept trailer, a Free Fire
 * ad, a Telegram repost and a fabricated Hollywood cast.
 *
 * Word boundaries are used throughout so "Edition"/"Editor" are not caught by
 * the fan-edit rule and "Creation" is not caught by "reaction".
 * ========================================================================== */

/** Fabricated content: presented as the anime, but not made by anyone official. */
export const FAKE_CONTENT_PATTERNS = [
    /\bconcept\s*(trailer|teaser|video|art)\b/i,
    /\bfan[\s-]?(made|film|trailer|animation|anime|dub|edit|art)\b/i,
    /\bfanmade\b/i,
    /\bwhat\s+if\b/i,
    /\b(ai|a\.?i\.?)[\s-]?(generated|made|animation|anime|trailer|art)\b/i,
    /\bmade\s+(with|using|by|in)\s+ai\b/i,
    /\b(made|created|animated|remade|reimagined)\s+\w+(\s+\w+)?\s+(with|using|in)\s+ai\b/i,
    /\bwith\s+ai\b/i,
    /\bai\s+(version|remake|edition)\b/i,
    /\b(midjourney|sora|runway ?ml|kling|veo)\b/i,
    /\bdeepfake\b/i,
    /\bparody\b/i,
    /\bmock[\s-]?(trailer|up)\b/i,
    /\bunofficial\b/i,
    /\bre[\s-]?imagined\b/i,
    // A comedy channel's "Naruto The Movie! (Official Fake Trailer)" scored 6 and
    // was only kept out by the ranking cut. "Official" in a title is not proof.
    /\bfake\s+(trailer|teaser|movie|anime|opening|reveal)\b/i,
];

/** Commentary about the anime rather than the anime itself. */
export const REACTION_RECAP_PATTERNS = [
    /\breact(ion|ions|ing|s)?\b/i,
    /\brecap(s|ped)?\b/i,
    /\bexplained\b/i,
    /\bbreak\s?down\b/i,
    /\breview(s|ed)?\b/i,
    /\btop\s*\d+\b/i,
    /\btier\s*list\b/i,
    /\brank(ing|ed)\b/i,
    /\bcompilation\b/i,
    /\ball\s+(deaths|fights|moments|openings)\b/i,
    /\bevery\s+(time|episode)\b/i,
];

/** Fan edits and raw source clips uploaded for other editors to reuse. */
export const FAN_EDIT_PATTERNS = [
    /\b(amv|asmv|gmv|mmv)\b/i,
    // \bedit\b deliberately: "Edition", "Editing" and "Editor" must NOT match.
    /\bedit(s|z)?\b/i,
    /\bcapcut\b/i,
    /\bslowed\s*(\+|and)?\s*reverb\b/i,
    /\bbadass\b/i,
    /\btwixtor\b/i,
    /\braw\s+clips?\b/i,
    /\bclips?\s+for\s+edit/i,
    /\b4k\s+clips?\b/i,
    /\bfree\s+to\s+use\b/i,
];

/**
 * Shorts / engagement bait. Found by the real dry run, which surfaced a cluster
 * of hashtag-stuffed reposts ("👆di atas full videonya ‼️#naruto #genji #cobra")
 * that every availability check happily passed.
 */
export const SHORTS_BAIT_PATTERNS = [
    /#shorts?\b/i,
    /\bfull\s+videonya\b/i,
    /\breaksi\b/i, // Indonesian "reaction"
    /\bmeme\s+(discussion|review)\b/i,
    /\btheories\s+be\s+like\b/i,
    /\bbe\s+like\s*:/i,
    /👆|⬆️/,
];

/** Game / brand collaborations: real ads, but for a product, not the anime. */
export const CROSSOVER_BRAND_PATTERNS = [
    /\bfree\s*fire\b/i,
    /\bfortnite\b/i,
    /\bpubg\b/i,
    /\bmobile\s+legends\b/i,
    /\broblox\b/i,
    /\bminecraft\b/i,
    /\bgenshin\b/i,
    /\bclash\s+(of\s+clans|royale)\b/i,
    /\bcall\s+of\s+duty\b/i,
    /\bbrawl\s+stars\b/i,
    /\bmonopoly\s+go\b/i,
];

/**
 * Video-game promos for a game *of* the anime. Real, official, and still not the
 * anime work — PlayStation's "NARUTO SHIPPUDEN: Ultimate Ninja STORM 4 Gameplay
 * Trailer" is a game ad. Kept separate from the crossover list because these are
 * tie-in games rather than unrelated brands.
 */
export const GAME_PROMO_PATTERNS = [
    /\bgameplay\b/i,
    /\b(mobile|video|new)\s+game\b/i,
    /\bgame\s+(trailer|reveal|launch|play)\b/i,
    /\b(ps4|ps5|xbox|nintendo\s+switch|steam|epic\s+games)\b/i,
    /\bopen\s+(beta|alpha)\b/i,
    /\bpre[\s-]?(register|order)\b/i,
    /\b(play|app)\s+store\b/i,
    /\bdlc\b/i,
    /\bcharacter\s+pack\b/i,
];

/**
 * Fan lyric videos: a music reupload with karaoke text, not a promo. Found by the
 * real dry run ("KANA-BOON -「Silhouette」 ... [KAN/ROM/ENG Lyrics]", score 5).
 */
export const LYRIC_VIDEO_PATTERNS = [
    /\blyrics?\b/i,
    /\b(kan|rom|eng)\s*\/\s*(kan|rom|eng)\b/i,
    /\bfull\s+ver\.?\b/i,
    /\bsub\s+español\b/i,
];

/**
 * "Official" is a word anyone can type. An untrusted channel announcing an
 * OFFICIAL new release or reveal is making a claim nothing can verify — the real
 * dry run found two mobile-game cutscene reposts titled "(2026) NEW OFFICIAL
 * NARUTO ANIMATION REVEAL!", both scoring 6. Deliberately narrow: it does not
 * touch a plain "Official Trailer", so smaller licensed distributors still pass.
 */
export const UNVERIFIED_OFFICIAL_CLAIM_PATTERNS = [
    /\bofficial\b[^\n]*\b(reveal|announcement|announced|leak(ed|s)?)\b/i,
    /\bnew\s+official\b/i,
];

/** Redistribution / aggregator signals, checked in the description too. */
export const REDISTRIBUTION_PATTERNS = [
    /\btelegram\b/i,
    /\bt\.me\//i,
    /\bdubbed[\s_]?only\b/i,
    /\bdownload\s+(link|here|now)\b/i,
    /\bjoin\s+now\s*:?\s*👇/i,
];

/**
 * Live action is context-dependent, never a global reject: real studios do
 * announce live-action adaptations. Untrusted uploaders claiming one are
 * fabricating, so the rule is (signal + untrusted), not (signal).
 */
export const LIVE_ACTION_PATTERN = /\blive[\s-]?action\b/i;

/**
 * Live-action adaptations of the anime, which are a *different work*.
 *
 * Found by auditing the first real 30-50 import: four of six Death Note videos
 * were live-action film trailers (the 2017 Netflix film, "Light Up The New
 * World", the 2006 Japanese film) and Attack on Titan had the live-action movie
 * trailer. Every one came from a genuinely licensed channel — Netflix, Madman,
 * Crunchyroll Store Australia — so channel trust cannot catch them, and each
 * scored 5-6 and was imported.
 *
 * This matters beyond tidiness: `Video.anime` points at an *anime* document, so a
 * live-action film trailer files real footage of a different production under the
 * anime's identity. Phase 6's RAG would then answer questions about the anime
 * using a Hollywood film's trailer as evidence.
 *
 * Applied only when the linked Anime is itself animated (every AniList format
 * here is), so it cannot misfire on a series that *is* live action.
 *
 * Detects the cases that announce themselves in the title. It is NOT complete:
 * "Death Note: Light Up The New World - Official Trailer" and "Death Note (2006)
 * English Trailer" are both live-action films whose titles carry no signal at all,
 * and no title heuristic can catch them. Those need a human decision, which is why
 * the audit reports them rather than the filter silently guessing.
 */
export const LIVE_ACTION_ADAPTATION_PATTERNS = [
    /\blive[\s-]?action\b/i,
    // Live-action cast members, which an animated production has no reason to bill.
    /\b(nat|nate)\s+wolff?\b/i,
    /\bwillem\s+dafoe\b/i,
    // "Thriller Movie", "Horror Movie" — genre labels used for film trailers.
    /\b(thriller|horror|drama|action)\s+movie\b/i,
];

/**
 * Explicit denylist of individual YouTube ids a human has reviewed and rejected.
 *
 * The escape hatch for content with NO detectable signal. Both entries below are
 * live-action Death Note films whose titles are indistinguishable from an anime
 * trailer — "Death Note: Light Up The New World - Official Trailer" from Madman
 * Films (a real licensed distributor) and "Death Note (2006) English Trailer [HD]".
 * There is nothing in the title, channel, duration or status to key off.
 *
 * Deliberately an id list, not more keywords. A keyword broad enough to catch
 * these ("(2006)", "new world") would reject legitimate anime videos, and the
 * codebase already showed how that fails: over-broad normalisation in
 * titleFingerprint silently merged two genuinely different Aniplex trailers.
 *
 * Rules for this list, so it stays small and honest:
 *   - one line per id, with the reason and the channel, because an unexplained id
 *     is impossible to re-audit later;
 *   - only for cases where no metadata signal exists — anything detectable belongs
 *     in a pattern above, where it also protects against future imports of the
 *     same *kind*;
 *   - a rejection here means "reviewed and rejected", never "unverified".
 *
 * This deliberately does NOT delete anything already stored. Removing existing
 * documents is a separate, explicitly approved operation.
 */
export const DENYLISTED_VIDEO_IDS = new Map([
    ["XBLJ18gcOjY", "live-action film 'Death Note: Light Up The New World' (Madman Films)"],
    ["mdZQ-_GLzYs", "live-action film 'Death Note' 2006 (HD Retro Trailers)"],
    ["uly_ONaG04s", "live-action film 'Death Note' 2006 remaster (HD Retro Trailers)"],
]);

/**
 * Hollywood names recurrently used in fabricated "live action" anime trailers.
 * Also context-dependent — an official channel may legitimately announce a cast.
 */
export const CASTING_NAME_PATTERNS = [
    /tom\s+holland/i, /henry\s+cavill/i, /sadie\s+sink/i, /timoth[ée]e?\s+chalamet/i,
    /jacob\s+elordi/i, /robert\s+pattinson/i, /zendaya/i, /millie\s+bobby\s+brown/i,
    /ryan\s+gosling/i, /cillian\s+murphy/i, /margot\s+robbie/i, /chris\s+hemsworth/i,
    /dwayne\s+johnson/i, /florence\s+pugh/i, /anya\s+taylor[\s-]joy/i, /jenna\s+ortega/i,
];

/**
 * Studios and licensed distributors, series-agnostic on purpose.
 *
 * Nothing here is Naruto-specific: the same list has to serve One Piece (Toei),
 * Jujutsu Kaisen (MAPPA/Crunchyroll), Attack on Titan (WIT/MAPPA) and Demon
 * Slayer (ufotable/Aniplex). Per-anime trust comes from `anime.studios`, which
 * is real AniList data, so a new series widens trust without a code change.
 */
export const TRUSTED_CHANNEL_TERMS = [
    "crunchyroll", "funimation", "aniplex", "toei animation", "toho animation",
    "studio pierrot", "viz media", "netflix", "muse asia", "ani-one", "medialink",
    // Japanese channel names, verified against the live API. Studio Pierrot's own
    // channel is "スタジオぴえろ【公式】" and matches none of the romanised terms, so
    // its genuine 20th-anniversary PV scored as if it were an unknown uploader.
    "スタジオぴえろ", "東映アニメーション", "アニプレックス", "ソニー・ミュージック",
    "sentai", "madman anime", "bandai namco", "kadokawa", "shueisha",
    "weekly shonen jump", "shonen jump", "mappa", "ufotable", "wit studio",
    "kyoto animation", "trigger", "bones", "sunrise", "madhouse", "pony canyon",
    "warner bros", "hidive", "prime video", "disney", "sonyanime", "tms anime",
    "kodansha", "cloverworks", "a-1 pictures", "production i.g", "gkids",
];

/**
 * Tokens too common to establish that a video is about a specific anime.
 *
 * Without this, "One Piece" would treat the word "one" as proof of relevance and
 * any title containing it would qualify. Distinctive partners ("piece", "titan",
 * "slayer", "clover") are deliberately absent, so multi-word titles still match.
 */
export const GENERIC_TITLE_TOKENS = new Set([
    "the", "and", "for", "you", "your", "all", "new", "one", "two", "three",
    "movie", "film", "season", "part", "anime", "series", "story", "world",
    "life", "love", "girl", "boy", "man", "men", "king", "hero", "war", "final",
    "first", "last", "live", "day", "night", "high", "school", "time", "great",
    "little", "big", "black", "white", "red", "blue", "dark", "light", "fire",
    "ice", "wind", "star", "sky", "sea", "god", "death", "dead", "blood",
    "special", "episode", "chapter", "arc", "not", "with", "from", "his", "her",
    "how", "why", "who", "what", "when", "get", "top", "sub", "dub", "eng",
    "name", "days", "young", "hidden", "second", "next", "over", "into", "true",
]);

const anyMatch = (patterns, text) => patterns.find((re) => re.test(text)) || null;
const norm = (s) => String(s || "").toLowerCase();

/**
 * Channel names are compared with all separators stripped.
 *
 * Real channels drop the spaces: VIZ Media's channel is literally "vizmedia", so
 * a substring test for "viz media" silently never matched and every legitimate
 * VIZ upload lost its trust bonus. Verified against the live API, not assumed.
 *
 * Unicode-aware on purpose. An ASCII-only [^a-z0-9] strip reduces a Japanese
 * channel name to the empty string, and `anyChannel.includes("")` is always
 * true — which silently marked EVERY uploader as trusted, including the
 * fabricated live-action fakes.
 */
export const flattenName = (s) => norm(s).replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Second belt for the same bug: a term that flattens to nothing must never
 * match, and an empty channel name must never match anything.
 */
export const channelMatchesTerm = (flatChannel, term) => {
    const t = flattenName(term);
    if (!t.length || !flatChannel.length) return false;
    return flatChannel.includes(t);
};

/** The "this is the real account" marker, in both languages. */
const OFFICIAL_MARKER_RE = /official|公式/i;

/**
 * Whether an uploader is an official studio or licensed distributor.
 *
 * Studio trust comes from `anime.studios` (real AniList data), so a newly ingested
 * series widens trust without a code change.
 */
export function isTrustedChannel(channelTitle, anime) {
    const flat = flattenName(channelTitle);
    if (!flat.length) return false;
    if (TRUSTED_CHANNEL_TERMS.some((term) => channelMatchesTerm(flat, term))) return true;
    return (anime?.studios || []).some((studio) => channelMatchesTerm(flat, studio));
}

/**
 * The series' own official channel — e.g. "ONE PIECE公式YouTubeチャンネル".
 *
 * Found by the 10-anime dry run, which rejected three genuine opening videos
 * posted by ONE PIECE's own account: it matches no studio and no distributor, so
 * it scored as an unknown uploader. Requires BOTH the anime's distinctive title
 * and an official marker, so "Naruto Fan Zone" (no marker) and "Official Trailer
 * Hub" (no title) are unaffected.
 *
 * Tracked separately from distributor trust because it is stronger: Crunchyroll
 * posts hundreds of series, but a series' own channel is about that series by
 * definition, which is why it alone may satisfy relevance.
 */
export function isAnimeOwnChannel(channelTitle, anime) {
    const flat = flattenName(channelTitle);
    if (!flat.length || !OFFICIAL_MARKER_RE.test(String(channelTitle))) return false;

    const { distinctive, phrases } = animeRelevanceTokens(anime);
    const candidates = [...distinctive, ...phrases].filter((t) => flattenName(t).length >= 4);
    return candidates.some((t) => flat.includes(flattenName(t)));
}

// Han / Hiragana / Katakana runs, used to keep native titles matchable.
const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu;

/**
 * Relevance vocabulary built from the anime's real AniList titles.
 *
 * All four stored titles are used (english, romaji, native, display) because they
 * disagree in ways a single field cannot cover: a video may be titled "Naruto
 * Shippuden", "Naruto: Shippuden", "NARUTO", "Naruto Opening 1" or
 * "NARUTO -ナルト- 疾風伝". A plain `title.includes(anime.title.display)` matches
 * none of the first four, since display is "Naruto: Shippuden" while the video
 * says "Naruto Shippuden".
 *
 * Returns:
 *   distinctive - latin word tokens that actually identify this series
 *   generic     - tokens dropped as too common to prove relevance
 *   phrases     - whole-title fallbacks (native CJK, and titles that are entirely
 *                 generic words like "Your Name", where no single token is safe)
 */
export function animeRelevanceTokens(anime) {
    const titles = [
        anime?.title?.english,
        anime?.title?.romaji,
        anime?.title?.native,
        anime?.title?.display,
    ].filter(Boolean);

    const distinctive = new Set();
    const generic = new Set();
    const phrases = new Set();

    for (const raw of titles) {
        const lowered = norm(raw);

        // Native/CJK titles have no spaces to split on; keep them as phrases.
        for (const run of lowered.match(CJK_RUN_RE) || []) phrases.add(run);

        const words = lowered.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
        let hasDistinctive = false;
        for (const word of words) {
            if (GENERIC_TITLE_TOKENS.has(word)) {
                generic.add(word);
            } else {
                distinctive.add(word);
                hasDistinctive = true;
            }
        }

        /**
         * A title made only of common words ("One Piece" minus "piece", "Your
         * Name", "Death Note") would otherwise have no usable token, and matching
         * on "one" alone would call any title containing "one" relevant. Requiring
         * the whole phrase keeps such series matchable without that false positive.
         */
        if (!hasDistinctive && words.length) phrases.add(words.join(" "));
    }

    return { distinctive: [...distinctive], generic: [...generic], phrases: [...phrases] };
}

/**
 * Which parts of the anime's identity appear in a video title.
 *
 * Compared against a separator-collapsed copy of the title so "Naruto:Shippuden",
 * "Naruto - Shippuden" and "Naruto  Shippuden" all behave the same. Generic
 * tokens are never sufficient on their own; they only appear here as extra
 * evidence once something distinctive already matched.
 */
export function matchAnimeTokens(videoTitle, anime) {
    const lowered = norm(videoTitle);
    const collapsed = lowered.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const { distinctive, generic, phrases } = animeRelevanceTokens(anime);

    const hits = [];
    for (const token of distinctive) {
        if (collapsed.includes(token)) hits.push(token);
    }
    for (const phrase of phrases) {
        // CJK phrases have no word gaps, so test the raw lowercase title too.
        if (collapsed.includes(phrase) || lowered.includes(phrase)) hits.push(phrase);
    }

    // Only counted as supporting evidence, never as the sole reason to accept.
    const supporting = hits.length ? generic.filter((t) => collapsed.includes(t)) : [];

    return { matched: hits, supporting, hasVocabulary: Boolean(distinctive.length || phrases.length) };
}

/** Promotional phrasing, including the Japanese equivalents used by JP channels. */
const PROMO_KEYWORD_RE = /\b(trailer|teaser|opening|ending|pv|preview|promo|op\s?\d|ed\s?\d)\b/i;
const PROMO_KEYWORD_JP_RE = /PV|予告|本編|特報|公開/;
const OFFICIAL_PROMO_RE = /official\s+(\w+\s+){0,2}(trailer|teaser|clip|opening|ending|pv|promo)/i;

const hasPromoKeyword = (title) => PROMO_KEYWORD_RE.test(title) || PROMO_KEYWORD_JP_RE.test(title);

/** Duration bounds. Trusted channels get a wider window — see assessQuality. */
export const DURATION_MIN_SECONDS = 10;
export const DURATION_MAX_SECONDS = 900;
export const DURATION_MAX_SECONDS_TRUSTED = 2400;
export const MIN_QUALITY_SCORE = 3;

/**
 * Quality verdict: { ok, score, signals } or { ok: false, reason, score }.
 *
 * Hard requirements run first and are absolute; the score only ranks what has
 * already earned the right to be considered. Deliberately not the reverse — a
 * high score must never be able to buy a fabricated video past a hard reject.
 */
export function assessQuality(video, { anime, minScore = MIN_QUALITY_SCORE } = {}) {
    const title = String(video?.title || "");
    const description = String(video?.description || "").slice(0, 1000);
    const channel = String(video?.channelTitle || "");
    const both = `${title}\n${description}`;

    // The series' own official account counts as trusted for every downstream rule.
    const ownChannel = isAnimeOwnChannel(channel, anime);
    const trustedChannel = ownChannel || isTrustedChannel(channel, anime);

    /* --- hard rejects: content that is not the real anime work --- */
    let hit;
    if ((hit = anyMatch(FAKE_CONTENT_PATTERNS, both)))
        return { ok: false, reason: `fabricated/fan content (${hit.source})`, score: 0, trustedChannel };
    if ((hit = anyMatch(REACTION_RECAP_PATTERNS, title)))
        return { ok: false, reason: `reaction/recap/commentary (${hit.source})`, score: 0, trustedChannel };
    if ((hit = anyMatch(FAN_EDIT_PATTERNS, title)))
        return { ok: false, reason: `fan edit/AMV (${hit.source})`, score: 0, trustedChannel };
    if ((hit = anyMatch(CROSSOVER_BRAND_PATTERNS, title)))
        return { ok: false, reason: `brand/game crossover promo (${hit.source})`, score: 0, trustedChannel };
    if ((hit = anyMatch(REDISTRIBUTION_PATTERNS, both)))
        return { ok: false, reason: `redistribution/aggregator signal (${hit.source})`, score: 0, trustedChannel };
    if ((hit = anyMatch(SHORTS_BAIT_PATTERNS, title)))
        return { ok: false, reason: `shorts/engagement bait (${hit.source})`, score: 0, trustedChannel };
    if ((hit = anyMatch(GAME_PROMO_PATTERNS, title)))
        return { ok: false, reason: `video-game promo, not the anime (${hit.source})`, score: 0, trustedChannel };

    // Both context-dependent: a licensed channel may legitimately post an official
    // theme-song video or a genuine reveal, so trust exempts them.
    if (!trustedChannel && (hit = anyMatch(LYRIC_VIDEO_PATTERNS, title)))
        return { ok: false, reason: `fan lyric/music reupload (${hit.source})`, score: 0, trustedChannel };
    if (!trustedChannel && (hit = anyMatch(UNVERIFIED_OFFICIAL_CLAIM_PATTERNS, title)))
        return { ok: false, reason: `unverifiable "official" claim from untrusted channel (${hit.source})`, score: 0, trustedChannel };

    /**
     * Hashtag stuffing. Official channels put keywords in the tags field, not
     * three or more hashtags in the visible title — that pattern is reposted
     * Shorts spam. Trusted channels are exempt so a real "#NARUTO20th #ぴえろ
     * #TVアニメ" promo is unaffected.
     */
    const hashtags = (title.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (hashtags >= 3 && !trustedChannel)
        return { ok: false, reason: `hashtag-stuffed title (${hashtags} hashtags)`, score: 0, trustedChannel };

    // Context-dependent, not global: the signal only condemns an untrusted source.
    const casting = anyMatch(CASTING_NAME_PATTERNS, title);
    const liveAction = LIVE_ACTION_PATTERN.test(title);
    if (casting && !trustedChannel)
        return { ok: false, reason: `Hollywood casting from untrusted channel (${casting.source})`, score: 0, trustedChannel };

    /**
     * A live-action adaptation is a different production from the anime, so it does
     * not belong under an animated Anime document regardless of who uploaded it.
     * This deliberately applies to trusted channels too — Netflix and Madman upload
     * the real thing, which is exactly the problem.
     */
    const animatedAnime = !anime || anime.format !== "LIVE_ACTION";
    if (animatedAnime && (hit = anyMatch(LIVE_ACTION_ADAPTATION_PATTERNS, `${title}\n${description}`)))
        return { ok: false, reason: `live-action adaptation, not the anime (${hit.source})`, score: 0, trustedChannel };

    /**
     * Relevance: the anime must actually be named in the title — unless the video
     * is on the series' own official channel, where "Opening Theme | We Are!" is
     * unambiguous without repeating the show's name.
     */
    const { matched, supporting, hasVocabulary } = matchAnimeTokens(title, anime);
    if (hasVocabulary && !matched.length && !ownChannel)
        return { ok: false, reason: "anime title absent from video title (off-topic)", score: 0, trustedChannel };

    /**
     * Duration sanity. The upper bound widens for trusted channels because the
     * real dry run found VIZ's 582s "ROAD OF NARUTO" anniversary PV and
     * Crunchyroll's 1800s official opening collection, both legitimate. A flat
     * 900s cap rejected genuine licensed content, so trust widens the window
     * rather than removing it. Null/0/negative never reach here — the
     * availability stage rejects them as "duration unavailable" first.
     */
    const maxDuration = trustedChannel ? DURATION_MAX_SECONDS_TRUSTED : DURATION_MAX_SECONDS;
    if (!Number.isFinite(video?.duration) || video.duration <= 0)
        return { ok: false, reason: "duration unavailable", score: 0, trustedChannel };
    if (video.duration < DURATION_MIN_SECONDS)
        return { ok: false, reason: `too short (${video.duration}s)`, score: 0, trustedChannel };
    if (video.duration > maxDuration)
        return { ok: false, reason: `too long for promo (${video.duration}s, cap ${maxDuration}s)`, score: 0, trustedChannel };

    /**
     * This ingestion exists to collect official promotional material, so a video
     * must either come from a trusted channel OR actually look like a promo.
     * Without this, a random clip repost cleared the bar on "+2 title match, +1
     * promo-length" alone — e.g. "Naruto Saves His Wife from Toneri Ōtsutsuki
     * ❤️🔥" from an unknown uploader. Expressed as a hard requirement rather than
     * a score tweak, so changing minScore later cannot silently reopen the hole.
     */
    const promoKeyword = hasPromoKeyword(title);
    if (!trustedChannel && !promoKeyword)
        return { ok: false, reason: "untrusted channel and no promotional keyword", score: 0, trustedChannel };

    /**
     * Openings and endings are the anime work itself, not promotional material.
     * A trailer exists to be shared; an OP/ED reupload from an unlicensed channel
     * is someone else's copyrighted footage. Every legitimate OP/ED the real dry
     * run found came from Crunchyroll or VIZ, so requiring trust here costs
     * nothing and drops reuploads like "Naruto Ending 4" from NarutosRasengan.
     */
    const isOpEd = /\b(opening|ending|op\s?\d|ed\s?\d)\b/i.test(title);
    const isTrailer = /\b(trailer|teaser|preview|promo|pv)\b/i.test(title) || PROMO_KEYWORD_JP_RE.test(title);
    if (isOpEd && !isTrailer && !trustedChannel)
        return { ok: false, reason: "opening/ending reupload from untrusted channel", score: 0, trustedChannel };

    /* --- score: orders the survivors --- */
    const signals = [];
    let score = 0;

    if (trustedChannel) {
        score += 5;
        signals.push(ownChannel ? "+5 series' own official channel" : "+5 trusted channel");
    }
    // 【公式】 is the standard Japanese "official channel" marker.
    if (OFFICIAL_MARKER_RE.test(channel) && (matched.length || ownChannel)) {
        score += 2;
        signals.push("+2 official channel");
    }
    if (OFFICIAL_PROMO_RE.test(title)) {
        score += 3;
        signals.push("+3 official promo in title");
    } else if (promoKeyword) {
        score += 2;
        signals.push("+2 promo keyword");
    }
    if (matched.length) {
        score += 2;
        signals.push(`+2 title match (${matched.join("/")}${supporting.length ? ` +${supporting.join("/")}` : ""})`);
    } else if (ownChannel) {
        // Relevance is established by the channel instead of the title.
        score += 2;
        signals.push("+2 series' own channel (relevance by channel)");
    }
    if (video.duration >= 15 && video.duration <= 300) {
        score += 1;
        signals.push("+1 promo-length");
    }
    if (liveAction) {
        score -= 3;
        signals.push("-3 live-action");
    }

    if (score < minScore)
        return { ok: false, reason: `quality score ${score} < ${minScore}`, score, signals, trustedChannel };

    return { ok: true, score, signals, trustedChannel };
}

/**
 * The filter. Returns { ok, score, signals } or { ok: false, reason }.
 *
 * Two stages, in this order and never reordered:
 *
 *   1. AVAILABILITY — id validity, metadata present, public, embeddable,
 *      processed, real duration, not live, no piracy term, not a duplicate.
 *      Facts from the videos.list payload only; nothing inferred.
 *   2. QUALITY — fabricated/reaction/fan-edit/crossover/redistribution/bait
 *      rejects, relevance to the anime, duration bounds, then trust scoring.
 *
 * Availability runs first so a quality rule can never accept something
 * unplayable, and the quality stage is purely additive — every original
 * rejection reason still fires exactly as before.
 *
 * `existingIds` covers what is already in MongoDB, `seenIds` what this run has
 * already accepted, so a video found by two different queries is not imported
 * twice. `anime` is optional: without it the quality stage still applies every
 * rule that does not depend on the series (relevance self-disables).
 */
export function evaluateVideo(video, { existingIds = new Set(), seenIds = new Set(), anime = null } = {}) {
    if (!video?.videoId) return { ok: false, reason: "no videoId" };
    if (!isValidYouTubeId(video.videoId)) return { ok: false, reason: "malformed videoId" };

    /**
     * Human review outranks every heuristic, so this is checked before anything
     * else: no score, trust level or pattern can readmit an id a person has already
     * rejected. Placed in stage 1 rather than assessQuality because it is a fact
     * about the id, not a judgement about the content.
     */
    if (DENYLISTED_VIDEO_IDS.has(video.videoId)) {
        return { ok: false, reason: `denylisted after review: ${DENYLISTED_VIDEO_IDS.get(video.videoId)}` };
    }

    // videos.list omits ids that are deleted/private/region-blocked, so an id that
    // survived discovery but has no title here is unavailable.
    if (!video.title) return { ok: false, reason: "unavailable (no metadata returned)" };

    if (video.privacyStatus !== "public") {
        return { ok: false, reason: `not public (${video.privacyStatus || "unknown"})` };
    }
    if (!video.embeddable) return { ok: false, reason: "not embeddable" };
    if (video.uploadStatus && video.uploadStatus !== "processed") {
        return { ok: false, reason: `upload status ${video.uploadStatus}` };
    }
    if (video.duration === null || video.duration === undefined) {
        return { ok: false, reason: "duration unavailable" };
    }
    // A live/upcoming stream has no stable duration and is not the promotional
    // content this ingestion is for.
    if (video.liveBroadcastContent && video.liveBroadcastContent !== "none") {
        return { ok: false, reason: `live content (${video.liveBroadcastContent})` };
    }

    const blocked = containsBlockedTerm(`${video.title} ${video.description.slice(0, 400)}`);
    if (blocked) return { ok: false, reason: `blocked term "${blocked}"` };

    if (existingIds.has(video.videoId)) return { ok: false, reason: "already exists in AnimeVerse" };
    if (seenIds.has(video.videoId)) return { ok: false, reason: "duplicate in this run" };

    // Stage 2. Reached only once the video is confirmed playable.
    return assessQuality(video, { anime });
}

/**
 * Conservative tags drawn from the Anime document — the anime's own title plus its
 * real AniList genres, lowercased. No invented keywords, and capped so a document
 * does not accumulate a dozen meaningless tags.
 */
export function buildTags(anime) {
    const tags = new Set();
    const display = anime?.title?.display || "";
    if (display) tags.add(display.toLowerCase());
    tags.add("anime");
    for (const genre of (anime?.genres || []).slice(0, 3)) {
        if (genre) tags.add(String(genre).toLowerCase());
    }
    return [...tags].slice(0, 6);
}

/**
 * YouTube metadata + Anime -> Video document.
 *
 * Only fields that exist on the Video schema are set. `videoFile` is left unset
 * entirely (not ""), because Phase 1 made it conditionally required — a YouTube
 * document legitimately has no file, and an empty string would be a fabricated
 * value. Descriptions are truncated because the schema requires a non-empty
 * description and YouTube descriptions can run to thousands of characters of
 * links and boilerplate.
 */
export function mapYouTubeVideoToDocument(video, { anime, ownerId }) {
    const description = (video.description || "").trim();

    return {
        sourceType: "youtube",
        externalVideoId: video.videoId,
        // videoFile intentionally omitted — see above.
        thumbnail: video.thumbnail,
        title: video.title.slice(0, 300),
        description: description ? description.slice(0, 5000) : video.title.slice(0, 300),
        duration: video.duration,
        views: 0,
        isPublished: true,
        owner: ownerId,
        anime: anime._id,
        tags: buildTags(anime),
        // Matches the schema's String category. Existing documents all use
        // "General"; "Anime" is the stronger, more accurate value for this content
        // and the field is free-form, so no convention is broken.
        category: "Anime",
    };
}

/**
 * A normalised title key used to spot the same video uploaded under two ids.
 *
 * The unique index on `externalVideoId` cannot catch this: "Death Note | Official
 * Trailer [HD] | Netflix" exists on both the "Netflix" and "Still Watching
 * Netflix" channels as two different ids, and the real import took both — same
 * runtime (137s/138s), identical description. Distributors routinely cross-post
 * to regional channels, so this is common rather than exceptional.
 *
 * Deliberately conservative: only bracketed/parenthesised suffixes, quality and
 * channel-suffix noise are stripped. It is a duplicate detector, not a similarity
 * score, so "Opening 1" and "Opening 2" must stay distinct.
 */
export function titleFingerprint(title) {
    // Quality/format noise only. NOT arbitrary bracketed text: stripping every
    // "(...)" merged Aniplex's 57s dub-cast trailer with its distinct 85s "(Mount
    // Natagumo)" arc trailer, which would have silently discarded real content.
    const NOISE = /^(?:hd|fhd|uhd|4k|8k|1080p?|720p?|60\s?fps|4k\s?60\s?fps|19\d\d|20\d\d)$/i;

    return String(title || "")
        .toLowerCase()
        // Drop a bracketed group only when its entire contents are noise.
        .replace(/[[(]([^\])]*)[\])]/g, (match, inner) =>
            NOISE.test(inner.replace(/[^a-z0-9]/gi, "")) ? " " : ` ${inner} `
        )
        .replace(/\b(hd|4k|60fps|full|official|sub|subbed|dub|dubbed|eng|english)\b/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

/**
 * Title fingerprints already stored, grouped by anime.
 *
 * Scoped per anime rather than globally: two different series can legitimately
 * have a video called "Opening 1", and collapsing those would silently drop real
 * content.
 */
export async function loadExistingTitleFingerprints() {
    const docs = await Video.find({ sourceType: "youtube" }).select("title anime").lean();
    const byAnime = new Map();
    for (const doc of docs) {
        const key = String(doc.anime || "none");
        if (!byAnime.has(key)) byAnime.set(key, new Set());
        byAnime.get(key).add(titleFingerprint(doc.title));
    }
    return byAnime;
}

/** Every YouTube id already stored, so discovery can skip them before videos.list. */
export async function loadExistingYouTubeIds() {
    const docs = await Video.find({ sourceType: "youtube" })
        .select("externalVideoId")
        .lean();
    return new Set(docs.map((doc) => doc.externalVideoId).filter(Boolean));
}

/**
 * Absolute ceiling on stored YouTube videos per anime, enforced in BOTH modes.
 *
 * The real failure this prevents: `--per-anime` caps a single run, so running
 * `--limit=5 --per-anime=3` and then `--limit=10 --per-anime=3` gave the first five
 * anime six videos each. Nothing in the old code consulted the database, so every
 * re-run added more and the collection grew without bound.
 *
 * A ceiling is kept even in per-run mode because that is the mode an operator gets
 * by default, and "the default cannot run away" is worth more than the extra videos
 * a large run might otherwise add. 6 matches the largest count the current dataset
 * legitimately reached.
 */
export const MAX_VIDEOS_PER_ANIME = 6;

/**
 * How many YouTube videos each anime already has stored.
 *
 * Grouped in the database rather than by loading every document, and keyed by
 * `String(anime._id)` so it can be looked up with the same key the fingerprint map
 * uses. Documents with no anime reference are irrelevant to a per-anime cap and are
 * excluded by the `$ne: null` match.
 */
export async function loadYouTubeCountsByAnime() {
    const rows = await Video.aggregate([
        { $match: { sourceType: "youtube", anime: { $ne: null } } },
        { $group: { _id: "$anime", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
}

/**
 * Turns "what the operator asked for" plus "what is already stored" into the number
 * of videos this run may still import for one anime.
 *
 * Two modes, because they answer different questions:
 *   totalCap=false (default, unchanged CLI semantics) — `perAnime` is a per-run
 *     allowance. Still clamped by the remaining headroom under the ceiling, so a
 *     repeated run tops out instead of growing for ever.
 *   totalCap=true (`--total-cap`) — `perAnime` is the desired TOTAL for the anime,
 *     so the run imports only the deficit. Re-running is then idempotent in effect:
 *     an anime already at the target is skipped and costs no quota.
 *
 * Returns 0 when the anime is full, which the caller uses to skip *before*
 * searching — a skipped anime costs nothing instead of 100 quota units per query.
 */
export function computeSlots({ perAnime, existingCount, totalCap = false, ceiling = MAX_VIDEOS_PER_ANIME }) {
    const already = Math.max(0, Number(existingCount) || 0);
    const want = Math.max(0, Number(perAnime) || 0);
    const target = totalCap ? Math.min(want, ceiling) : ceiling;
    const headroom = Math.max(0, target - already);
    return totalCap ? headroom : Math.min(want, headroom);
}

/**
 * Resolves which anime to ingest for. Never calls AniList — Phase 2 owns that, and
 * this reads the existing collection only.
 */
export async function resolveTargetAnime({ animeName, animeId, limit } = {}) {
    if (animeId) {
        if (!mongoose.isValidObjectId(animeId)) {
            throw new Error(`"${animeId}" is not a valid Mongo ObjectId`);
        }
        const anime = await Anime.findById(animeId);
        return anime ? [anime] : [];
    }

    if (animeName) {
        // Anchored, case-insensitive match on any of the stored titles. Escaped so a
        // title containing regex metacharacters cannot alter the query.
        const escaped = String(animeName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "i");
        const found = await Anime.find({
            $or: [
                { "title.display": pattern },
                { "title.english": pattern },
                { "title.romaji": pattern },
            ],
        }).limit(5);
        return found;
    }

    // Default: most popular first, so a conservative run covers recognisable series.
    return Anime.find().sort({ popularity: -1 }).limit(Number(limit) || 10);
}

/**
 * The ingestion run.
 *
 * Flow per anime: build queries -> search (discovery) -> dedupe ids -> ONE batched
 * videos.list for authoritative metadata -> filter -> insert. Deduplicating before
 * videos.list matters because the same trailer is routinely returned by several
 * queries, and it keeps the batch small.
 *
 * A quota error aborts the whole run (retrying cannot help); any other per-video
 * error is recorded and the run continues.
 */
export async function ingestYouTubeForAnime({
    animeList,
    perAnime = 3,
    queriesPerAnime = 2,
    dryRun = false,
    ownerId = null,
    totalCap = false,
    onEvent = () => {},
}) {
    const report = {
        animeProcessed: 0,
        searches: 0,
        discovered: 0,
        uniqueDiscovered: 0,
        accepted: 0,
        rejected: 0,
        imported: 0,
        alreadyExists: 0,
        skippedFull: 0,
        failed: 0,
        failures: [],
        rejections: [],
        items: [],
        quotaExhausted: false,
    };

    const existingIds = await loadExistingYouTubeIds();
    const seenIds = new Set();
    // Same-title-different-id protection; see titleFingerprint.
    const fingerprintsByAnime = await loadExistingTitleFingerprints();
    // Stored counts, so a repeated run tops up instead of growing without bound.
    const countsByAnime = await loadYouTubeCountsByAnime();

    for (const anime of animeList) {
        const title = anime?.title?.display;
        if (!title) {
            report.failed += 1;
            report.failures.push({ anime: String(anime?._id), reason: "Anime document has no display title" });
            continue;
        }

        /**
         * Decide the run's allowance for this anime BEFORE searching. Checking after
         * the search would still cost 100 quota units per query for an anime that
         * cannot accept a single video.
         */
        const existingCount = countsByAnime.get(String(anime._id)) || 0;
        const slots = computeSlots({ perAnime, existingCount, totalCap });

        if (slots === 0) {
            report.skippedFull += 1;
            onEvent({
                type: "skipped",
                title,
                animeId: anime._id,
                reason: totalCap
                    ? `already has ${existingCount}/${Math.min(perAnime, MAX_VIDEOS_PER_ANIME)} video(s) — nothing to top up`
                    : `already at the ${MAX_VIDEOS_PER_ANIME}-video ceiling (${existingCount})`,
            });
            continue;
        }

        report.animeProcessed += 1;
        onEvent({ type: "anime", title, animeId: anime._id, existingCount, slots });

        const queries = QUERY_TEMPLATES.slice(0, queriesPerAnime).map((build) => build(title));
        const candidateIds = new Set();

        for (const query of queries) {
            onEvent({ type: "query", title, query });
            try {
                // Slight over-fetch relative to perAnime, since filtering will
                // discard some results; still bounded to keep quota predictable.
                const results = await searchVideos(query, { maxResults: Math.min(slots * 2 + 2, 15) });
                report.searches += 1;
                report.discovered += results.length;

                for (const result of results) {
                    if (!existingIds.has(result.videoId) && !seenIds.has(result.videoId)) {
                        candidateIds.add(result.videoId);
                    } else if (existingIds.has(result.videoId)) {
                        report.alreadyExists += 1;
                    }
                }
            } catch (error) {
                if (error instanceof YouTubeQuotaError) {
                    report.quotaExhausted = true;
                    onEvent({ type: "quota", message: error.message });
                    return report;
                }
                report.failed += 1;
                report.failures.push({ anime: title, query, reason: error.message });
                onEvent({ type: "failed", title, query, reason: error.message });
            }
        }

        if (!candidateIds.size) continue;
        report.uniqueDiscovered += candidateIds.size;

        // One batched call for authoritative metadata (1 quota unit for up to 50).
        let details;
        try {
            const items = await getVideoDetails([...candidateIds]);
            details = items.map(normaliseVideoItem);
        } catch (error) {
            if (error instanceof YouTubeQuotaError) {
                report.quotaExhausted = true;
                onEvent({ type: "quota", message: error.message });
                return report;
            }
            report.failed += 1;
            report.failures.push({ anime: title, reason: `videos.list failed: ${error.message}` });
            onEvent({ type: "failed", title, reason: error.message });
            continue;
        }

        // Ids that vanished between search and videos.list are unavailable.
        const returned = new Set(details.map((d) => d.videoId));
        for (const id of candidateIds) {
            if (!returned.has(id)) {
                report.rejected += 1;
                report.rejections.push({ videoId: id, reason: "unavailable (not returned by videos.list)" });
                onEvent({ type: "filtered", videoId: id, reason: "unavailable" });
            }
        }

        /**
         * Rank, then take — never "first N that pass".
         *
         * Every candidate is evaluated before anything is chosen, because YouTube
         * returns by its own relevance and the batched videos.list response is in
         * request order, so the earliest passing result is not the best one. The
         * old break-at-N loop imported whatever came first: a 2-minute repost
         * could be taken while the official trailer further down was never even
         * scored.
         */
        const ranked = [];

        // Titles already stored for THIS anime, plus ones accepted in this run.
        const animeKey = String(anime._id);
        const titleKeys = new Set(fingerprintsByAnime.get(animeKey) || []);

        for (const video of details) {
            const verdict = evaluateVideo(video, { existingIds, seenIds, anime });
            if (!verdict.ok) {
                report.rejected += 1;
                report.rejections.push({ videoId: video.videoId, title: video.title, reason: verdict.reason });
                onEvent({ type: "filtered", videoId: video.videoId, title: video.title, reason: verdict.reason });
                continue;
            }
            ranked.push({ video, verdict, fingerprint: titleFingerprint(video.title) });
        }

        /**
         * Deterministic ordering. Score decides; ties fall back to trust, then
         * newest upload, then videoId — YouTube's search ordering changes between
         * runs, so without a total order the same query could import a different
         * video each time and the run would not be reproducible.
         */
        ranked.sort((a, b) => {
            if (b.verdict.score !== a.verdict.score) return b.verdict.score - a.verdict.score;
            const trust = Number(b.verdict.trustedChannel) - Number(a.verdict.trustedChannel);
            if (trust !== 0) return trust;
            const bPublished = Date.parse(b.video.publishedAt || "") || 0;
            const aPublished = Date.parse(a.video.publishedAt || "") || 0;
            if (bPublished !== aPublished) return bPublished - aPublished;
            return String(a.video.videoId).localeCompare(String(b.video.videoId));
        });

        /**
         * Drop same-title duplicates AFTER sorting, so the highest-scoring copy of a
         * cross-posted trailer is the one kept (Netflix over "Still Watching
         * Netflix"). Done before the top-N cut so a duplicate cannot consume a slot
         * that a genuinely different video should have had.
         */
        const deduped = [];
        for (const entry of ranked) {
            if (entry.fingerprint && titleKeys.has(entry.fingerprint)) {
                const reason = "duplicate title already present for this anime";
                report.rejected += 1;
                report.rejections.push({ videoId: entry.video.videoId, title: entry.video.title, reason });
                onEvent({ type: "filtered", videoId: entry.video.videoId, title: entry.video.title, reason });
                continue;
            }
            if (entry.fingerprint) titleKeys.add(entry.fingerprint);
            deduped.push(entry);
        }

        const selected = deduped.slice(0, slots);

        // Candidates that passed every filter but lost the ranking cut. Counted as
        // filtered, not accepted, so the totals stay honest.
        for (const { video, verdict } of deduped.slice(slots)) {
            const reason = `ranked below top ${slots} for this anime (score ${verdict.score})`;
            report.rejected += 1;
            report.rejections.push({ videoId: video.videoId, title: video.title, reason });
            onEvent({ type: "filtered", videoId: video.videoId, title: video.title, reason });
        }

        for (const { video, verdict } of selected) {
            report.accepted += 1;
            seenIds.add(video.videoId);

            const summary = {
                videoId: video.videoId,
                title: video.title,
                channelTitle: video.channelTitle,
                duration: video.duration,
                embeddable: video.embeddable,
                score: verdict.score,
                signals: verdict.signals,
                anime: title,
                animeId: anime._id,
            };

            if (dryRun) {
                report.items.push({ ...summary, action: "would import" });
                onEvent({ type: "would-import", ...summary });
                continue;
            }

            try {
                const doc = mapYouTubeVideoToDocument(video, { anime, ownerId });
                const created = await Video.create(doc);
                report.imported += 1;
                report.items.push({ ...summary, action: "imported", _id: created._id });
                onEvent({ type: "imported", ...summary, _id: created._id });
            } catch (error) {
                // E11000 means the partial unique index caught a concurrent/duplicate
                // insert — not a failure, just an already-existing video.
                if (error?.code === 11000) {
                    report.accepted -= 1;
                    report.alreadyExists += 1;
                    onEvent({ type: "exists", ...summary });
                } else {
                    report.failed += 1;
                    report.failures.push({ anime: title, videoId: video.videoId, reason: error.message });
                    onEvent({ type: "failed", ...summary, reason: error.message });
                }
            }
        }
    }

    return report;
}
