import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

export const VIDEO_SOURCE_TYPES = ["cloudinary", "youtube"];

const videoSchema = new Schema(
    {
        /**
         * Where the playable media lives.
         *
         * "cloudinary" — a creator-uploaded file; `videoFile` holds the Cloudinary
         *                secure_url and is played by the HTML5 <video> element.
         * "youtube"    — an externally hosted video played through YouTube's own
         *                official embed; `externalVideoId` holds the YouTube ID and
         *                `videoFile` stays empty. Nothing is downloaded or re-hosted.
         *
         * The default keeps every pre-existing document (which has no sourceType
         * field at all) behaving exactly as before.
         */
        sourceType: {
            type: String,
            enum: VIDEO_SOURCE_TYPES,
            default: "cloudinary",
            index: true,
        },

        // Only meaningful when sourceType === "youtube" (e.g. "dQw4w9WgXcQ").
        externalVideoId: { type: String, default: "" },

        /**
         * `required` is now a function rather than `true`. Mongoose evaluates it with
         * `this` bound to the document, so a Cloudinary video still cannot be saved
         * without a file, while a YouTube video is allowed to have none. Making this
         * unconditionally required would make YouTube documents unsavable; dropping
         * the requirement entirely would let a broken Cloudinary upload through.
         */
        videoFile: {
            type: String,
            required: function () {
                return this.sourceType !== "youtube";
            },
        },
        thumbnail: { type: String, required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },
        duration: { type: Number, default: 0 },
        views: { type: Number, default: 0 },
        isPublished: { type: Boolean, default: true },
        owner: { type: Schema.Types.ObjectId, ref: "User" },

        /**
         * Optional link to the canonical anime this video is about (an AMV of
         * Attack on Titan, a review of Frieren...). Optional and null by default:
         * a video is perfectly valid without one, and every existing creator
         * upload keeps working untouched. Indexed sparsely because most documents
         * will hold null and a sparse index skips those entirely.
         */
        anime: {
            type: Schema.Types.ObjectId,
            ref: "Anime",
            default: null,
            index: { sparse: true },
        },

        // --- AI enrichment fields ---
        tags: { type: [String], default: [], index: true },
        category: { type: String, default: "General", index: true },
        aiSummary: { type: String, default: "" },
        transcript: { type: String, default: "" },
        transcriptLang: { type: String, default: "en" },

        /**
         * --- Embedding + its provenance ---
         *
         * The vector alone is not enough to know whether it can be used. The
         * collection already contains 32-dimensional vectors written by an earlier
         * scaffold that fabricated them when no API key was present, and a bare
         * array gives no way to tell those from a real 1536-float
         * text-embedding-3-small vector. Comparing the two is not a weak signal but
         * noise, so the metadata below records exactly what produced each vector and
         * a vector is only trusted when all of it matches the active configuration
         * in config/embedding.config.js.
         *
         * Nothing here is deleted or migrated: a stale vector simply stops being
         * eligible for search until it is reindexed.
         */

        // select:false, as before. Aggregations bypass that — hence the existing
        // `embedding: 0` projections in the video/dashboard/like/comment/user/
        // subscription controllers, which remain the enforcement point there.
        embedding: { type: [Number], default: [], select: false },

        // Which model produced the vector, e.g. "text-embedding-3-small". Null on
        // every legacy document, which is exactly what makes them detectable.
        embeddingModel: { type: String, default: null, select: false },

        // Stored rather than derived from embedding.length so a truncated or
        // partially written array can be caught by cross-checking the two.
        embeddingDimensions: { type: Number, default: null, select: false },

        // The text recipe, e.g. "metadata-v1". Same model over different input text
        // yields vectors that are comparable arithmetically but not semantically.
        embeddingVersion: { type: String, default: null, select: false },

        embeddingGeneratedAt: { type: Date, default: null, select: false },

        // SHA-256 of the exact string embedded. Lets the backfill skip documents
        // whose meaningful content has not changed, making re-runs cheap and
        // idempotent instead of re-billing for identical vectors.
        embeddingTextHash: { type: String, default: null, select: false },
    },
    { timestamps: true }
);

/**
 * The counterpart to the conditional `videoFile` requirement above: a YouTube
 * video is unplayable without its ID, so reject it at the model boundary rather
 * than letting a document that can never render reach the database.
 *
 * This is a path validator on `externalVideoId` (not a pre-save hook) so it also
 * runs for `Model.create`, `save`, and `findOneAndUpdate` with `runValidators`.
 * Legacy Cloudinary documents are untouched: for them the branch is a no-op.
 */
videoSchema.path("externalVideoId").validate(function () {
    if (this.sourceType !== "youtube") return true;
    return typeof this.externalVideoId === "string" && this.externalVideoId.trim().length > 0;
}, "externalVideoId is required when sourceType is 'youtube'");

/**
 * Prevents the same YouTube video from being imported twice.
 *
 * A plain unique index on { sourceType, externalVideoId } cannot be used here: the
 * pre-existing Cloudinary documents have no `externalVideoId` field at all, so they
 * would all index as { "cloudinary", null } and collide with each other. Creating
 * such an index against the live collection fails outright with E11000 (verified).
 *
 * The partial filter narrows the index to YouTube documents that actually carry a
 * string id, so Cloudinary documents are not indexed at all and are completely
 * unaffected — any number of them may exist with no externalVideoId.
 */
videoSchema.index(
    { sourceType: 1, externalVideoId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            sourceType: "youtube",
            externalVideoId: { $type: "string" },
        },
    }
);

// Text search across title + description
videoSchema.index({ title: "text", description: "text", tags: "text" });

/**
 * Lets the backfill find documents whose vector was made by a different model or
 * text version without scanning the whole collection. Not unique, and not sparse:
 * legacy documents have neither field, and a null/null entry is precisely what a
 * "needs reindexing" query looks for.
 */
videoSchema.index({ embeddingModel: 1, embeddingVersion: 1 });

videoSchema.plugin(mongooseAggregatePaginate);

export const Video = mongoose.model("Video", videoSchema);
