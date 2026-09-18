import mongoose, { isValidObjectId } from "mongoose";
import { CommunityComment, CommunityPost, FanClub } from "../models/community.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const viewerObjectId = (req) =>
    req.user?._id ? new mongoose.Types.ObjectId(String(req.user._id)) : null;

const postProjectionStages = (viewerId) => [
    {
        $lookup: {
            from: "users",
            localField: "author",
            foreignField: "_id",
            as: "author",
            pipeline: [{ $project: { username: 1, avatar: 1, fullName: 1 } }],
        },
    },
    {
        $lookup: {
            from: "communitycomments",
            let: { postId: "$_id" },
            pipeline: [
                { $match: { $expr: { $eq: ["$post", "$$postId"] } } },
                { $count: "count" },
            ],
            as: "commentStats",
        },
    },
    {
        $addFields: {
            author: { $first: "$author" },
            upvoteCount: { $size: { $ifNull: ["$upvotes", []] } },
            commentCount: {
                $ifNull: [{ $first: "$commentStats.count" }, 0],
            },
            hasUpvoted: viewerId
                ? { $in: [viewerId, { $ifNull: ["$upvotes", []] }] }
                : false,
            selectedPollOption: viewerId
                ? {
                      $let: {
                          vars: {
                              matches: {
                                  $map: {
                                      input: { $ifNull: ["$pollOptions", []] },
                                      as: "option",
                                      in: {
                                          $in: [viewerId, { $ifNull: ["$$option.voters", []] }],
                                      },
                                  },
                              },
                          },
                          in: {
                              $let: {
                                  vars: { idx: { $indexOfArray: ["$$matches", true] } },
                                  in: {
                                      $cond: [
                                          { $gte: ["$$idx", 0] },
                                          "$$idx",
                                          null,
                                      ],
                                  },
                              },
                          },
                      },
                  }
                : null,
            pollOptions: {
                $map: {
                    input: { $ifNull: ["$pollOptions", []] },
                    as: "option",
                    in: {
                        text: "$$option.text",
                        votes: { $size: { $ifNull: ["$$option.voters", []] } },
                    },
                },
            },
        },
    },
    // Relationship arrays are private. Clients get only aggregate counts and
    // their own boolean/index state.
    {
        $project: {
            upvotes: 0,
            commentStats: 0,
            "pollOptions.voters": 0,
        },
    },
];

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

    let safeImageUrl = "";
    if (imageUrl) {
        try {
            const parsed = new URL(String(imageUrl));
            if (!["http:", "https:"].includes(parsed.protocol)) {
                throw new Error("unsupported protocol");
            }
            safeImageUrl = parsed.toString();
        } catch {
            throw new ApiError(400, "Image URL must be a valid http(s) URL");
        }
    }

    const doc = {
        type,
        title: title.trim(),
        content: content?.trim() || "",
        imageUrl: safeImageUrl,
        author: req.user._id,
    };
    if (fanClub && isValidObjectId(fanClub)) doc.fanClub = fanClub;
    if (type === "poll") {
        const options = Array.isArray(pollOptions)
            ? pollOptions.map((value) => String(value).trim()).filter(Boolean)
            : [];
        if (options.length < 2) throw new ApiError(400, "Poll requires at least 2 options");
        if (options.length > 6) throw new ApiError(400, "Poll supports up to 6 options");
        doc.pollOptions = options.map((text) => ({ text, voters: [] }));
        if (pollClosesAt) doc.pollClosesAt = new Date(pollClosesAt);
    }

    const post = await CommunityPost.create(doc);
    const [populated] = await CommunityPost.aggregate([
        { $match: { _id: post._id } },
        ...postProjectionStages(viewerObjectId(req)),
    ]);
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
        ...postProjectionStages(viewerObjectId(req)),
    ]);

    const posts = await CommunityPost.aggregatePaginate(aggregate, {
        page: pageNumber,
        limit: limitNumber,
    });
    return res.json(new ApiResponse(200, posts, "OK"));
});

export const getPost = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid post id");

    const [post] = await CommunityPost.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(postId) } },
        ...postProjectionStages(viewerObjectId(req)),
    ]);

    if (!post) throw new ApiError(404, "Post not found");
    return res.json(new ApiResponse(200, post, "OK"));
});

export const upvotePost = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid id");
    const post = await CommunityPost.findById(postId);
    if (!post) throw new ApiError(404, "Post not found");

    const has = post.upvotes.some((userId) => userId.equals(req.user._id));
    if (has) post.upvotes = post.upvotes.filter((userId) => !userId.equals(req.user._id));
    else post.upvotes.push(req.user._id);
    await post.save();

    return res.json(
        new ApiResponse(
            200,
            { upvoteCount: post.upvotes.length, hasUpvoted: !has },
            "OK"
        )
    );
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

    // One vote per user. Voting for another option moves the vote instead of
    // duplicating it, so the selected state is always unambiguous.
    post.pollOptions.forEach((option) => {
        option.voters = option.voters.filter((voter) => !voter.equals(req.user._id));
    });
    post.pollOptions[idx].voters.push(req.user._id);
    await post.save();

    const options = post.pollOptions.map((option) => ({
        text: option.text,
        votes: option.voters.length,
    }));

    return res.json(
        new ApiResponse(
            200,
            {
                pollOptions: options,
                selectedPollOption: idx,
                totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
            },
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
    await CommunityComment.deleteMany({ post: post._id });
    await post.deleteOne();
    return res.json(new ApiResponse(200, {}, "Deleted"));
});

// ---- Community discussion threads ----
export const listPostComments = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid post id");

    const exists = await CommunityPost.exists({ _id: postId });
    if (!exists) throw new ApiError(404, "Post not found");

    const comments = await CommunityComment.find({ post: postId })
        .populate("author", "username avatar fullName")
        .sort({ createdAt: 1 })
        .limit(250)
        .lean();

    return res.json(new ApiResponse(200, comments, "OK"));
});

export const addPostComment = asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const { content, parentId } = req.body;
    if (!isValidObjectId(postId)) throw new ApiError(400, "Invalid post id");
    if (!content?.trim()) throw new ApiError(400, "Comment is required");
    if (content.trim().length > 1200) throw new ApiError(400, "Comment is too long");

    const post = await CommunityPost.exists({ _id: postId });
    if (!post) throw new ApiError(404, "Post not found");

    let parent = null;
    if (parentId) {
        if (!isValidObjectId(parentId)) throw new ApiError(400, "Invalid parent comment id");
        const parentComment = await CommunityComment.findOne({ _id: parentId, post: postId }).lean();
        if (!parentComment) throw new ApiError(404, "Parent comment not found");
        // Keep threads readable: replying to a reply attaches to the root.
        parent = parentComment.parent || parentComment._id;
    }

    const comment = await CommunityComment.create({
        post: postId,
        author: req.user._id,
        content: content.trim(),
        parent,
    });

    const populated = await CommunityComment.findById(comment._id)
        .populate("author", "username avatar fullName")
        .lean();

    return res.status(201).json(new ApiResponse(201, populated, "Comment added"));
});

export const deletePostComment = asyncHandler(async (req, res) => {
    const { postId, commentId } = req.params;
    if (!isValidObjectId(postId) || !isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid id");
    }

    const comment = await CommunityComment.findOne({ _id: commentId, post: postId });
    if (!comment) throw new ApiError(404, "Comment not found");
    if (!comment.author.equals(req.user._id)) throw new ApiError(403, "Not authorized");

    // Replies have no children because addPostComment flattens nested replies.
    // A root with replies is retained as a small placeholder so other people's
    // replies do not disappear with it.
    const replyCount = await CommunityComment.countDocuments({ parent: comment._id });
    if (replyCount > 0 && !comment.parent) {
        comment.content = "[deleted]";
        await comment.save();
    } else {
        await comment.deleteOne();
    }

    return res.json(new ApiResponse(200, {}, "Comment deleted"));
});
