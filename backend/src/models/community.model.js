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

// Community post (discussion / meme / news share)
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

        // for polls
        pollOptions: [
            {
                text: String,
                voters: [{ type: Schema.Types.ObjectId, ref: "User" }],
            },
        ],
        pollClosesAt: { type: Date },

        // AI enrichment
        aiSentiment: { type: String, default: "" },
        tags: { type: [String], default: [] },
    },
    { timestamps: true }
);

postSchema.plugin(mongooseAggregatePaginate);

export const FanClub = mongoose.model("FanClub", fanClubSchema);
export const CommunityPost = mongoose.model("CommunityPost", postSchema);
