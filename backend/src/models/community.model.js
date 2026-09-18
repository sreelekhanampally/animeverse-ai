import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

// FanClub
const fanClubSchema = new Schema(
    {
        name: { type: String, required: true, trim: true, index: true },
        slug: { type: String, required: true, unique: true, index: true, lowercase: true },
        description: { type: String, default: "" },
        banner: { type: String, default: "" },
        members: [{ type: Schema.Types.ObjectId, ref: "User" }],
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true }
);

// Community post (discussion / meme / news / poll)
const postSchema = new Schema(
    {
        type: {
            type: String,
            enum: ["discussion", "meme", "poll", "news"],
            default: "discussion",
            index: true,
        },
        title: { type: String, required: true, trim: true },
        content: { type: String, default: "" },
        imageUrl: { type: String, default: "" },
        fanClub: { type: Schema.Types.ObjectId, ref: "FanClub", index: true },
        author: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        upvotes: [{ type: Schema.Types.ObjectId, ref: "User" }],

        // Poll state stays server-side. Feed responses expose only counts and the
        // current viewer's selected option, never the voter id arrays.
        pollOptions: [
            {
                text: String,
                voters: [{ type: Schema.Types.ObjectId, ref: "User" }],
            },
        ],
        pollClosesAt: { type: Date },

        // Optional enrichment fields used by future discovery features.
        aiSentiment: { type: String, default: "" },
        tags: { type: [String], default: [] },
    },
    { timestamps: true }
);

postSchema.plugin(mongooseAggregatePaginate);

// Discussion replies are separate from video comments. This keeps community
// threads independently queryable and avoids mixing two unrelated comment types.
const communityCommentSchema = new Schema(
    {
        post: {
            type: Schema.Types.ObjectId,
            ref: "CommunityPost",
            required: true,
            index: true,
        },
        author: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        content: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1200,
        },
        // One level of replies is enough for a readable card-style community.
        // The controller prevents replies-to-replies from becoming deeper trees.
        parent: {
            type: Schema.Types.ObjectId,
            ref: "CommunityComment",
            default: null,
            index: true,
        },
    },
    { timestamps: true }
);

communityCommentSchema.index({ post: 1, createdAt: 1 });

export const FanClub = mongoose.model("FanClub", fanClubSchema);
export const CommunityPost = mongoose.model("CommunityPost", postSchema);
export const CommunityComment = mongoose.model("CommunityComment", communityCommentSchema);
