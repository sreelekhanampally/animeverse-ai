import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const videoSchema = new Schema(
    {
        videoFile: { type: String, required: true },
        thumbnail: { type: String, required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },
        duration: { type: Number, default: 0 },
        views: { type: Number, default: 0 },
        isPublished: { type: Boolean, default: true },
        owner: { type: Schema.Types.ObjectId, ref: "User" },

        // --- AI enrichment fields ---
        tags: { type: [String], default: [], index: true },
        category: { type: String, default: "General", index: true },
        aiSummary: { type: String, default: "" },
        transcript: { type: String, default: "" },
        transcriptLang: { type: String, default: "en" },
        embedding: { type: [Number], default: [], select: false },
    },
    { timestamps: true }
);

// Text search across title + description
videoSchema.index({ title: "text", description: "text", tags: "text" });

videoSchema.plugin(mongooseAggregatePaginate);

export const Video = mongoose.model("Video", videoSchema);
