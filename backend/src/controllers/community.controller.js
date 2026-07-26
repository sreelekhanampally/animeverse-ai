import mongoose, { isValidObjectId } from "mongoose";
import { CommunityPost, FanClub } from "../models/community.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ---- Fan clubs ----
export const createFanClub = asyncHandler(async (req, res) => {
    const { name, description, banner } = req.body;
    if (!name?.trim()) throw new ApiError(400, "Name is required");
    const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const exists = await FanClub.findOne({ slug });
    if (exists) throw new ApiError(409, "Fan club with this name already exists");
    const club = await FanClub.create({
        name: name.trim(),
        slug,
        description: description || "",
        banner: banner || "",
        createdBy: req.user._id,
        members: [req.user._id],
    });
    return res.status(201).json(new ApiResponse(201, club, "Fan club created"));
});

export const listFanClubs = asyncHandler(async (req, res) => {
    const clubs = await FanClub.find()
        .populate("createdBy", "username avatar fullName")
        .sort({ createdAt: -1 })
        .lean();
    return res.json(new ApiResponse(200, clubs, "OK"));
});

export const joinFanClub = asyncHandler(async (req, res) => {
    const { clubId } = req.params;
    if (!isValidObjectId(clubId)) throw new ApiError(400, "Invalid id");
    const club = await FanClub.findByIdAndUpdate(
        clubId,
        { $addToSet: { members: req.user._id } },
        { new: true }
    );
    if (!club) throw new ApiError(404, "Club not found");
    return res.json(new ApiResponse(200, club, "Joined"));
});

export const leaveFanClub = asyncHandler(async (req, res) => {
    const { clubId } = req.params;
    if (!isValidObjectId(clubId)) throw new ApiError(400, "Invalid id");
    const club = await FanClub.findByIdAndUpdate(
        clubId,
        { $pull: { members: req.user._id } },
        { new: true }
    );
    if (!club) throw new ApiError(404, "Club not found");
    return res.json(new ApiResponse(200, club, "Left"));
});

// ---- Community posts ----
export const createPost = asyncHandler(async (req, res) => {
    const { type = "discussion", title, content, imageUrl, fanClub, pollOptions, pollClosesAt } = req.body;
    if (!title?.trim()) throw new ApiError(400, "Title is required");

    const doc = {
        type,
        title: title.trim(),
        content: content?.trim() || "",
        imageUrl: imageUrl || "",
        author: req.user._id,
    };
    if (fanClub && isValidObjectId(fanClub)) doc.fanClub = fanClub;
    if (type === "poll") {
        if (!Array.isArray(pollOptions) || pollOptions.length < 2) {
            throw new ApiError(400, "Poll requires at least 2 options");
        }
        doc.pollOptions = pollOptions.map((t) => ({ text: String(t).trim(), voters: [] }));
        if (pollClosesAt) doc.pollClosesAt = new Date(pollClosesAt);
    }
    const post = await CommunityPost.create(doc);
    const populated = await CommunityPost.findById(post._id).populate("author", "username avatar fullName");
    return res.status(201).json(new ApiResponse(201, populated, "Post created"));
});

export const listPosts = asyncHandler(async (req, res) => {
    const { type, fanClub, page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit) || 20));

    const match = {};
    if (type) match.type = type;
    if (fanClub && isValidObjectId(fanClub)) match.fanClub = new mongoose.Types.ObjectId(fanClub);

    const aggregate = CommunityPost.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            $lookup: {
                from: "users",
                localField: "author",
                foreignField: "_id",
                as: "author",
                pipeline: [{ $project: { username: 1, avatar: 1, fullName: 1 } }],
            },
        },
        { $addFields: { author: { $first: "$author" }, upvoteCount: { $size: "$upvotes" } } },
        { $project: { upvotes: 0 } },
    ]);

    const posts = await CommunityPost.aggregatePaginate(aggregate, { page: pageNumber, limit: limitNumber });
    return res.json(new ApiResponse(200, posts, "OK"));
});

export const upvotePost = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid id");
    const post = await CommunityPost.findById(postId);
    if (!post) throw new ApiError(404, "Post not found");
    const has = post.upvotes.some((u) => u.equals(req.user._id));
    if (has) post.upvotes = post.upvotes.filter((u) => !u.equals(req.user._id));
    else post.upvotes.push(req.user._id);
    await post.save();
    return res.json(new ApiResponse(200, { upvotes: post.upvotes.length, hasUpvoted: !has }, "OK"));
});

export const votePoll = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const { optionIndex } = req.body;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid id");
    const post = await CommunityPost.findById(postId);
    if (!post || post.type !== "poll") throw new ApiError(404, "Poll not found");
    if (post.pollClosesAt && post.pollClosesAt < new Date()) {
        throw new ApiError(400, "Poll has closed");
    }
    const idx = Number(optionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= post.pollOptions.length) {
        throw new ApiError(400, "Invalid option");
    }
    // remove existing vote from any option
    post.pollOptions.forEach((o) => {
        o.voters = o.voters.filter((v) => !v.equals(req.user._id));
    });
    post.pollOptions[idx].voters.push(req.user._id);
    await post.save();
    return res.json(
        new ApiResponse(
            200,
            post.pollOptions.map((o) => ({ text: o.text, votes: o.voters.length })),
            "Vote recorded"
        )
    );
});

export const deletePost = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid id");
    const post = await CommunityPost.findById(postId);
    if (!post) throw new ApiError(404, "Post not found");
    if (!post.author.equals(req.user._id)) throw new ApiError(403, "Not authorized");
    await post.deleteOne();
    return res.json(new ApiResponse(200, {}, "Deleted"));
});
