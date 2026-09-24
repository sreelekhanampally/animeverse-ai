import mongoose, { Schema } from "mongoose";

export const RAG_SOURCE_TYPES = ["anime", "video", "creator_transcript"];

const ragChunkSchema = new Schema(
    {
        chunkKey: { type: String, required: true, unique: true, index: true },
        sourceType: {
            type: String,
            enum: RAG_SOURCE_TYPES,
            required: true,
            index: true,
        },
        sourceCollection: {
            type: String,
            enum: ["Anime", "Video"],
            required: true,
        },
        sourceId: { type: String, required: true, index: true },
        sourceTitle: { type: String, required: true, trim: true },
        section: { type: String, required: true, index: true },
        chunkIndex: { type: Number, required: true, default: 0 },
        text: { type: String, required: true },
        metadata: { type: Schema.Types.Mixed, default: {} },

        indexVersion: { type: String, required: true, index: true },
        contentHash: { type: String, required: true, index: true },
        isActive: { type: Boolean, default: true, index: true },

        embedding: { type: [Number], default: [], select: false },
        embeddingModel: { type: String, default: null, select: false },
        embeddingDimensions: { type: Number, default: null, select: false },
        embeddingVersion: { type: String, default: null, select: false },
        embeddingGeneratedAt: { type: Date, default: null, select: false },
        embeddingTextHash: { type: String, default: null, select: false },
    },
    { timestamps: true }
);

ragChunkSchema.index({ sourceType: 1, sourceId: 1, section: 1, chunkIndex: 1 });
ragChunkSchema.index({ isActive: 1, indexVersion: 1, sourceType: 1 });
ragChunkSchema.index({ embeddingModel: 1, embeddingVersion: 1 });
ragChunkSchema.index(
    { sourceTitle: "text", text: "text" },
    {
        weights: { sourceTitle: 8, text: 1 },
        name: "rag_chunk_text",
    }
);

export const RagChunk = mongoose.model("RagChunk", ragChunkSchema);
