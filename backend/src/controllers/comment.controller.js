import mongoose from "mongoose"
import {Comment} from "../models/comment.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"

const getVideoComments = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const pageNumber = Math.max(1, parseInt(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const aggregate = Comment.aggregate([
        {
            $match: {
                video: new mongoose.Types.ObjectId(videoId)
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "owner",
                pipeline: [
                    {
                        $project: {
                            username: 1,
                            avatar: 1
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                owner: {
                    $first: "$owner"
                }
            }
        },
        {
            $project: {
                video: 0
            }
        }
    ]);

    const comments = await Comment.aggregatePaginate(aggregate, {
        page: pageNumber,
        limit: limitNumber,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            comments,
            "Comments fetched successfully"
        )
    );
});

const addComment = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { content } = req.body;

    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    if (!content?.trim()) {
        throw new ApiError(400, "Comment is required");
    }

    const comment = await Comment.create({
        content: content.trim(),
        video: videoId,
        owner: req.user._id
    });
    const createdComment = await Comment.findById(comment._id)
        .populate("owner", "username avatar fullName");
    return res.status(201).json(
        new ApiResponse(
            201,
            createdComment,
            "Comment added successfully"
        )
    );
});

const updateComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const { content } = req.body;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
        throw new ApiError(400, "Invalid comment id");
    }

    if (!content?.trim()) {
        throw new ApiError(400, "Content is required");
    }

    const comment = await Comment.findOneAndUpdate(
        {
            _id: commentId,
            owner: req.user._id
        },
        {
            $set: {
                content
            }
        },
        {
            new: true
        }
    );

    if (!comment) {
        throw new ApiError(404, "Comment not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            comment,
            "Comment updated successfully"
        )
    );
});

const deleteComment = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
        throw new ApiError(400, "Invalid comment id");
    }

    const comment = await Comment.findOneAndDelete({
        _id: commentId,
        owner: req.user._id
    });

    if (!comment) {
        throw new ApiError(404, "Comment not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Comment deleted successfully"
        )
    );
});

/**
 * GET /comments/user/videos — the videos the current user has commented on.
 *
 * This is the Library / "Commented videos" query. It is derived entirely from the
 * existing `comments` collection: a comment already references both `owner` and
 * `video`, so "videos I commented on" is a $group over those two fields. No new
 * model, no denormalised list on the User document, and nothing extra written at
 * comment time — which means it is automatically correct for the 61 comments that
 * already exist, and it cannot drift out of sync with the comments themselves.
 *
 * Response contract: ApiResponse.data is a FLAT ARRAY OF VIDEO DOCUMENTS, the
 * same shape as GET /likes/videos, each with:
 *   - myCommentsCount : how many comments this user left on that video
 *   - lastCommentedAt : timestamp of their most recent comment (sort key)
 *
 * Requirements this satisfies directly:
 *   - $group by video means a video appears exactly ONCE no matter how many times
 *     the user commented on it (requirement 5).
 *   - Because the list is computed from live comments, deleting a user's last
 *     comment on a video removes that video from the Library on the next read,
 *     while deleting only one of several comments leaves it in place
 *     (requirement 6). deleteComment needed no change for this to hold.
 */
const getCommentedVideos = asyncHandler(async (req, res) => {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const commentedVideos = await Comment.aggregate([
        {
            $match: {
                owner: userId,
                video: { $exists: true, $ne: null }
            }
        },
        // One entry per video, regardless of how many comments the user left.
        {
            $group: {
                _id: "$video",
                myCommentsCount: { $sum: 1 },
                lastCommentedAt: { $max: "$createdAt" }
            }
        },
        { $sort: { lastCommentedAt: -1 } },
        {
            $lookup: {
                from: "videos",
                localField: "_id",
                foreignField: "_id",
                as: "video",
                pipeline: [
                    { $match: { isPublished: true } },
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                { $project: { username: 1, fullName: 1, avatar: 1 } }
                            ]
                        }
                    },
                    { $addFields: { owner: { $first: "$owner" } } },
                    {
                        $lookup: {
                            from: "likes",
                            localField: "_id",
                            foreignField: "video",
                            as: "likes"
                        }
                    },
                    {
                        $lookup: {
                            from: "comments",
                            localField: "_id",
                            foreignField: "video",
                            as: "comments"
                        }
                    },
                    {
                        $addFields: {
                            likesCount: { $size: "$likes" },
                            commentsCount: { $size: "$comments" },
                            isLiked: { $in: [userId, "$likes.likedBy"] },
                            // Same legacy-document normalisation the other video
                            // listings apply.
                            sourceType: { $ifNull: ["$sourceType", "cloudinary"] },
                            externalVideoId: { $ifNull: ["$externalVideoId", ""] }
                        }
                    },
                    {
                        $project: {
                            likes: 0,
                            comments: 0,
                            __v: 0,
                            embedding: 0
                        }
                    }
                ]
            }
        },
        // A comment on a since-deleted or unpublished video yields no video here.
        // Skip it rather than emitting an unrenderable placeholder. The comment
        // itself is left untouched in the database.
        { $match: { "video.0": { $exists: true } } },
        {
            $replaceWith: {
                $mergeObjects: [
                    { $first: "$video" },
                    {
                        myCommentsCount: "$myCommentsCount",
                        lastCommentedAt: "$lastCommentedAt"
                    }
                ]
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            commentedVideos,
            "Commented videos fetched successfully"
        )
    );
});

export {
    getVideoComments,
    addComment,
    updateComment,
     deleteComment,
     getCommentedVideos
    }