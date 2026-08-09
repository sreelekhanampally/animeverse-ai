import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

/**
 * Canonical anime metadata imported from AniList.
 *
 * This collection is *reference data*, not user-generated content: a document
 * describes a series (Attack on Titan), while a Video describes a piece of
 * content a user uploaded. They are deliberately separate collections, linked
 * by an optional `Video.anime` reference.
 *
 * Only fields AnimeVerse can actually use are stored. AniList exposes far more
 * (airing schedules, rankings, staff, relations, external links, streaming
 * episodes, tags with rank/percentages...), and copying all of it would create
 * a large surface of data we would have to keep in sync without ever reading.
 */

// AniList's own enum values, kept verbatim so a document round-trips faithfully.
export const ANIME_STATUSES = [
    "FINISHED",
    "RELEASING",
    "NOT_YET_RELEASED",
    "CANCELLED",
    "HIATUS",
];

export const ANIME_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];

export const ANIME_FORMATS = [
    "TV",
    "TV_SHORT",
    "MOVIE",
    "SPECIAL",
    "OVA",
    "ONA",
    "MUSIC",
];

/**
 * Characters are embedded rather than given their own collection. They are only
 * ever read together with their anime, there is no cross-anime character query
 * in the product, and the list is capped at ingestion time — so a subdocument
 * array avoids a join for no benefit. `_id: false` keeps Mongoose from minting
 * an ObjectId per character, since AniList's own id is the identity here.
 */
const characterSchema = new Schema(
    {
        anilistId: { type: Number },
        name: { type: String, required: true },
        role: { type: String }, // MAIN | SUPPORTING | BACKGROUND
        image: { type: String, default: "" },
    },
    { _id: false }
);

const animeSchema = new Schema(
    {
        /**
         * External identity. Every ingestion decision (insert vs update) is made
         * on this field, never on the title — titles are not unique on AniList
         * ("Fruits Basket" exists three times) and can be edited upstream.
         */
        anilistId: {
            type: Number,
            required: true,
            unique: true,
            index: true,
        },

        // MyAnimeList id, when AniList knows it. Useful later for cross-referencing;
        // frequently null, so it is never treated as an identity.
        malId: { type: Number, default: null },

        /**
         * AniList returns up to three titles and *any* of them can be null
         * (english is missing for many older or niche series). `title.display` is
         * resolved once at ingestion so every consumer has one safe field to read
         * instead of repeating `english || romaji || native` everywhere.
         */
        title: {
            romaji: { type: String, default: "" },
            english: { type: String, default: "" },
            native: { type: String, default: "" },
            display: { type: String, required: true, index: true },
        },

        // Plain text. AniList descriptions arrive with <br>/<i> markup, which is
        // stripped during mapping so this is safe to render anywhere.
        description: { type: String, default: "" },

        genres: { type: [String], default: [], index: true },

        coverImage: {
            extraLarge: { type: String, default: "" },
            large: { type: String, default: "" },
            color: { type: String, default: "" }, // dominant colour, handy for UI accents
        },
        bannerImage: { type: String, default: "" },

        /**
         * Nullable on purpose. Long-running series still airing (One Piece) have
         * `episodes: null` upstream — a 0 default would be a fabricated fact, so
         * the absence of knowledge is preserved as null.
         */
        episodes: { type: Number, default: null },
        duration: { type: Number, default: null }, // minutes per episode

        season: { type: String, enum: [...ANIME_SEASONS, null], default: null },
        seasonYear: { type: Number, default: null, index: true },
        format: { type: String, enum: [...ANIME_FORMATS, null], default: null },

        // Flat array of studio names; only main studios are ingested. Producers and
        // licensors are dropped as AnimeVerse has no use for them.
        studios: { type: [String], default: [] },

        characters: { type: [characterSchema], default: [] },

        source: { type: String, default: null }, // MANGA | ORIGINAL | LIGHT_NOVEL | ...
        status: { type: String, enum: [...ANIME_STATUSES, null], default: null, index: true },

        averageScore: { type: Number, default: null }, // 0-100
        popularity: { type: Number, default: 0, index: true },

        isAdult: { type: Boolean, default: false },
        siteUrl: { type: String, default: "" },
        trailer: {
            id: { type: String, default: "" },
            site: { type: String, default: "" }, // youtube | dailymotion
        },
        startYear: { type: Number, default: null },

        // Provenance. Lets a later re-sync find stale documents without guessing
        // from `updatedAt`, which also changes when unrelated fields are touched.
        metadataSource: { type: String, default: "anilist" },
        lastSyncedAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

// Text search over the three titles + description, mirroring the Video model's
// existing text index so search behaves consistently across collections.
animeSchema.index({
    "title.romaji": "text",
    "title.english": "text",
    "title.display": "text",
    description: "text",
});

animeSchema.plugin(mongooseAggregatePaginate);

export const Anime = mongoose.model("Anime", animeSchema);
