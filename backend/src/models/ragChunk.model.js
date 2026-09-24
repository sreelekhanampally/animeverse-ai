import mongoose, { Schema } from "mongoose";

export const RAG_SOURCE_TYPES = [
    "anime_metadata",
    "anime_synopsis",
    "video_metadata",
    "creator_transcript",
];

const ragChunkSchema = new Schema(
    {
        sourceType: {
            type: String,
            enum: RAG_SOURCE_TYPES,
            required: true,
            index: true,
        },
        sourceId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        anime: {
            type: Schema.Types.ObjectId,
            ref: "Anime",
            default: null,
            index: true,
        },
        video: {
            type: Schema.Types.ObjectId,
            ref: "Video",
            default: null,
            index: true,
        },
        title: { type: String, required: true },
        content: { type: String, required: true },
        chunkIndex: { type: Number, required: true, min: 0 },
        chunkCount: { type: Number, required: true, min: 1 },

        metadata: {
            genres: { type: [String], default: [] },
            category: { type: String, default: "" },
            videoSourceType: { type: String, default: "" },
            animeMetadataSource: { type: String, default: "" },
            transcriptLang: { type: String, default: "" },
        },

        contentHash: { type: String, required: true, index: true },
        indexVersion: { type: String, required: true, default: "rag-v1", index: true },
        indexRunId: { type: String, required: true, index: true },

        embedding: { type: [Number], default: [], select: false },
        embeddingModel: { type: String, default: null, select: false },
        embeddingDimensions: { type: Number, default: null, select: false },
        embeddingVersion: { type: String, default: null, select: false },
        embeddingGeneratedAt: { type: Date, default: null, select: false },
        embeddingTextHash: { type: String, default: null, select: false },
    },
    { timestamps: true }
);

ragChunkSchema.index(
    { sourceType: 1, sourceId: 1, chunkIndex: 1, indexVersion: 1 },
    { unique: true }
);

ragChunkSchema.index({
    title: "text",
    content: "text",
    "metadata.genres": "text",
    "metadata.category": "text",
});

ragChunkSchema.index({ embeddingModel: 1, embeddingVersion: 1, sourceType: 1 });

export const RagChunk = mongoose.model("RagChunk", ragChunkSchema);
