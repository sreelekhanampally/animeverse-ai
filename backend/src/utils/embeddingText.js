/**
 * Deterministic embedding-text construction.
 *
 * Two documents with the same meaningful content must produce byte-identical
 * text, because the SHA-256 of that text is what tells a later backfill "this is
 * already indexed, skip it". If the text wobbled — array order, stray whitespace,
 * a timestamp — every run would re-embed everything and spend money to write
 * identical vectors.
 *
 * PRIVACY IS STRUCTURAL, NOT A FILTER
 * -----------------------------------
 * These builders read an explicit list of named fields. Nothing is spread, no
 * object is walked, no `Object.keys` loop appears below. That is deliberate: a
 * denylist of secret-looking keys would silently start leaking the moment someone
 * adds a new sensitive field to a model. A whitelist cannot, because a field that
 * is never named is never read.
 *
 * Consequently a password hash, refreshToken, email, API key or any other value
 * that happens to sit on the document — or on a populated `owner` — cannot reach
 * the embedding provider. `owner` is not read at all: who uploaded a video is not
 * a semantic property of it, and reading it would put user data one populate away
 * from a third-party API call.
 *
 * YOUTUBE
 * -------
 * A YouTube video contributes only the metadata already persisted by the Data API
 * v3 ingestion. No media is fetched, nothing is downloaded, re-hosted, converted
 * or sent to Whisper, and the video's bytes never exist locally to begin with.
 * `sourceType` alone decides this — never the owner. A YouTube video imported
 * under the AnimeVerse Official account is still sourceType "youtube" and is
 * treated exactly like any other YouTube video here.
 */

import { createHash } from "node:crypto";
import { EMBEDDING_MAX_CHARS } from "../config/embedding.config.js";

/**
 * Per-section caps, so one enormous field cannot crowd out the rest.
 *
 * The transcript is emitted last and gets whatever budget remains, which means
 * the global truncation at the end trims transcript tail first and never eats the
 * title or genres — the fields that carry the most retrieval signal per character.
 */
const MAX_DESCRIPTION_CHARS = 4000;
const MAX_ANIME_DESCRIPTION_CHARS = 3000;
const MAX_TRANSCRIPT_CHARS = 12000;
const MAX_CHARACTERS = 10;
const MAX_TAGS = 25;

/**
 * Placeholder text the previous scaffold returned from `transcribeAudio` when no
 * API key was configured. If any of it was ever persisted it is not a transcript,
 * it is an error message, and embedding it would pollute the vector with a
 * sentence about missing configuration. Matched case-insensitively on the
 * distinctive fragments rather than the whole string, since the original contained
 * irregular double spaces.
 */
const STUB_TRANSCRIPT_MARKERS = [
    "(ai stub)",
    "transcription unavailable",
    "set openai_api_key",
];

/** Collapses whitespace so cosmetic edits do not change the hash. */
const clean = (value) => {
    if (typeof value !== "string") return "";
    return value
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};

const truncate = (value, max) => {
    const text = clean(value);
    return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
};

/**
 * Normalises a string array: trimmed, de-duplicated case-insensitively, sorted.
 *
 * Sorted because the *set* of genres or tags is what matters semantically, while
 * their incoming order is incidental — AniList may reorder genres upstream, and
 * an AI tagger emits tags in whatever order it felt like. Without sorting, a
 * reordered-but-identical list would hash differently and trigger a pointless
 * re-embed.
 */
const normaliseList = (values, max) => {
    if (!Array.isArray(values)) return [];
    const seen = new Map();
    for (const raw of values) {
        const value = clean(raw);
        if (!value) continue;
        const key = value.toLowerCase();
        if (!seen.has(key)) seen.set(key, value);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "en")).slice(0, max);
};

/** Emits "Label: value" only when there is a value, so absent data leaves no trace. */
const field = (label, value) => {
    const text = clean(typeof value === "number" ? String(value) : value);
    return text ? `${label}: ${text}` : null;
};

/**
 * True when a document's stored transcript may participate in its embedding.
 *
 * Exported because this is a rule worth testing directly, and because the
 * backfill reports on it.
 *
 * Three conditions, all required:
 *   1. sourceType is not "youtube" — a YouTube video has no transcript we are
 *      allowed to have produced, so any value in that field is untrustworthy and
 *      is ignored outright rather than trusted because it happens to be there.
 *   2. A non-empty string is actually stored. Nothing is generated on demand:
 *      this function never triggers transcription of any kind.
 *   3. It is not one of the old stub placeholders described above.
 *
 * Note the check is on sourceType, never on owner. A Cloudinary upload owned by
 * AnimeVerse Official is eligible; a YouTube import owned by the same account is
 * not.
 */
export const isTranscriptEligible = (video) => {
    if (!video) return false;
    // Legacy documents predate the field entirely and are Cloudinary uploads,
    // which is exactly what the model's own default encodes.
    const sourceType = video.sourceType || "cloudinary";
    if (sourceType === "youtube") return false;

    const transcript = clean(video.transcript);
    if (!transcript) return false;

    const lowered = transcript.toLowerCase();
    if (STUB_TRANSCRIPT_MARKERS.some((marker) => lowered.includes(marker))) return false;

    return true;
};

/**
 * Anime -> embedding text.
 *
 * Field choice follows what AniList actually backs and what a user would plausibly
 * search by: the three title variants plus the resolved display title (an English
 * speaker types "Attack on Titan", a Japanese speaker "進撃の巨人", and neither
 * should miss), the plain-text synopsis, genres, studios, format, status, season
 * and year, and the main cast — character names are a very common way people
 * describe the show they are looking for.
 *
 * Deliberately excluded: scores, popularity, episode counts, image URLs, siteUrl,
 * anilistId, malId, timestamps. Numbers and URLs consume budget and add no
 * semantic signal — nobody searches for "averageScore 86", and a cover-image URL
 * is noise that would dilute the vector.
 */
export function buildAnimeEmbeddingText(anime) {
    if (!anime) return "";

    const title = anime.title || {};

    // Title variants are de-duplicated but NOT sorted: `display` is the canonical
    // one and leads, which keeps the most useful string at the front where a
    // truncation can never reach it.
    const titles = [];
    const pushTitle = (value) => {
        const text = clean(value);
        if (text && !titles.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
            titles.push(text);
        }
    };
    pushTitle(title.display);
    pushTitle(title.english);
    pushTitle(title.romaji);
    pushTitle(title.native);

    const genres = normaliseList(anime.genres, 30);
    const studios = normaliseList(anime.studios, 10);

    // MAIN first, then SUPPORTING, so the cap keeps the recognisable names. Role
    // order is explicit rather than relying on the ingestion sort surviving.
    const characters = Array.isArray(anime.characters)
        ? [...anime.characters]
              .filter((character) => clean(character?.name))
              .sort((a, b) => {
                  const rank = (role) => (String(role).toUpperCase() === "MAIN" ? 0 : 1);
                  const byRole = rank(a?.role) - rank(b?.role);
                  if (byRole !== 0) return byRole;
                  // Alphabetical tiebreak keeps the output stable when two
                  // characters share a role.
                  return clean(a.name).localeCompare(clean(b.name), "en");
              })
              .slice(0, MAX_CHARACTERS)
              .map((character) => clean(character.name))
        : [];

    const season = [clean(anime.season), anime.seasonYear ? String(anime.seasonYear) : ""]
        .filter(Boolean)
        .join(" ");

    return [
        field("Anime", titles[0]),
        titles.length > 1 ? field("Also known as", titles.slice(1).join(" | ")) : null,
        field("Format", anime.format),
        field("Status", anime.status),
        field("Season", season),
        field("Studios", studios.join(", ")),
        field("Genres", genres.join(", ")),
        field("Main characters", characters.join(", ")),
        field("Synopsis", truncate(anime.description, MAX_ANIME_DESCRIPTION_CHARS)),
    ]
        .filter(Boolean)
        .join("\n")
        .slice(0, EMBEDDING_MAX_CHARS);
}

/**
 * A compact anime block for embedding inside a video's text.
 *
 * Shorter than the standalone anime text on purpose: the video's own title and
 * description are the primary signal, and a full synopsis would dominate a
 * two-line video description and make every video about the same series look
 * identical to the searcher.
 */
const animeContextForVideo = (anime) => {
    if (!anime) return [];
    const title = anime.title || {};
    const names = [];
    for (const value of [title.display, title.english, title.romaji, title.native]) {
        const text = clean(value);
        if (text && !names.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
            names.push(text);
        }
    }
    if (!names.length) return [];

    return [
        field("Anime", names.join(" | ")),
        field("Anime genres", normaliseList(anime.genres, 30).join(", ")),
        field("Anime studios", normaliseList(anime.studios, 10).join(", ")),
        field(
            "Anime season",
            [clean(anime.season), anime.seasonYear ? String(anime.seasonYear) : ""]
                .filter(Boolean)
                .join(" ")
        ),
    ].filter(Boolean);
};

/**
 * Video -> embedding text.
 *
 * `anime` may arrive either populated on `video.anime` or passed explicitly by a
 * caller that resolved it separately (the backfill does the latter, to fetch each
 * anime once instead of once per video). An unpopulated ObjectId is ignored rather
 * than stringified — "68f0a1..." is not something anyone searches for.
 *
 * Note what does NOT appear: videoFile, externalVideoId, thumbnail, owner, views,
 * duration, timestamps. URLs and identifiers are not searchable language. Their
 * absence is also what makes this function work identically for both source
 * types — a YouTube video has no videoFile and needs none, so nothing here can
 * fail or degrade because of that.
 */
export function buildVideoEmbeddingText(video, { anime = null } = {}) {
    if (!video) return "";

    // Prefer an explicitly supplied anime, else a populated one. A populated
    // document is recognised by having a `title` object; a bare ObjectId does not.
    const linkedAnime =
        anime || (video.anime && typeof video.anime === "object" && video.anime.title ? video.anime : null);

    const tags = normaliseList(video.tags, MAX_TAGS);

    const parts = [
        field("Title", video.title),
        field("Category", video.category),
        field("Tags", tags.join(", ")),
        ...animeContextForVideo(linkedAnime),
        field("Description", truncate(video.description, MAX_DESCRIPTION_CHARS)),
    ].filter(Boolean);

    // Last, so the global cap trims the transcript before any metadata.
    if (isTranscriptEligible(video)) {
        const transcript = truncate(video.transcript, MAX_TRANSCRIPT_CHARS);
        if (transcript) parts.push(`Transcript: ${transcript}`);
    }

    return parts.join("\n").slice(0, EMBEDDING_MAX_CHARS);
}

/**
 * Stable fingerprint of the exact string that was embedded.
 *
 * Stored on the document as `embeddingTextHash`, which is what makes the backfill
 * resumable and idempotent: unchanged text hashes the same, so the document is
 * skipped without an API call. SHA-256 rather than a cheap hash because a
 * collision would mean silently keeping a stale vector.
 *
 * The hash is of content that is already non-secret by construction, so it is
 * safe to persist and is not itself sensitive.
 */
export const hashEmbeddingText = (text) =>
    createHash("sha256").update(typeof text === "string" ? text : "", "utf8").digest("hex");
