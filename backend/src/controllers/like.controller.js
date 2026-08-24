import mongoose, {isValidObjectId} from "mongoose"
import {Like} from "../models/like.model.js"
import { Comment } from "../models/comment.model.js";
import { Video } from "../models/video.model.js";
import { Tweet } from "../models/tweet.model.js";
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"

/**
 * POST /likes/toggle/v/:videoId
 *
 * Returns { isLiked, likesCount } instead of the previous empty `{}`. The client
 * had no way to learn the outcome of its own request, so it could only guess by
 * flipping a local boolean — and a guess is exactly what drifts out of sync when
 * two clicks race or a request fails. Now the server states the result.
 *
 * The toggle is also atomic. The old read-then-write (findOne, then create)
 * allowed two concurrent requests to both observe "not liked" and both insert;
 * the unique (video, likedBy) index would reject the second with an unhandled
 * E11000 surfaced as a 500. deleteOne() reports whether it removed anything, so
 * the decision and the write are a single operation — the same pattern already
 * used by toggleSubscription.
 */
const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId).select("_id");

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    const { deletedCount } = await Like.deleteOne({
        video: videoId,
        likedBy: req.user._id
    });

    let isLiked;

    if (deletedCount > 0) {
        isLiked = false;
    } else {
        try {
            await Like.create({
                video: videoId,
                likedBy: req.user._id
            });
        } catch (error) {
            // 11000 = duplicate key on the unique (video, likedBy) index. A
            // concurrent request already created it, so the user is liked either
            // way — not an error worth surfacing.
            if (error?.code !== 11000) throw error;
        }
        isLiked = true;
    }

    // Recounted from the collection so the client can trust this number rather
    // than maintaining its own counter. There is no denormalised count on the
    // Video document, so this is the only source of truth.
    const likesCount = await Like.countDocuments({ video: videoId });

    return res.status(isLiked ? 201 : 200).json(
        new ApiResponse(
            isLiked ? 201 : 200,
            { isLiked, likesCount },
            isLiked ? "Video liked successfully" : "Video unliked successfully"
        )
    );
});

const toggleCommentLike = asyncHandler(async (req, res) => {
    const { commentId } = req.params;

    if (!isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment id");
    }

    const comment = await Comment.findById(commentId);

    if (!comment) {
        throw new ApiError(404, "Comment not found");
    }

    const likedComment = await Like.findOne({
        comment: commentId,
        likedBy: req.user._id
    });

    if (likedComment) {
        await likedComment.deleteOne();

        return res.status(200).json(
            new ApiResponse(
                200,
                {},
                "Comment unliked successfully"
            )
        );
    }

    await Like.create({
        comment: commentId,
        likedBy: req.user._id
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            {},
            "Comment liked successfully"
        )
    );
});

const toggleTweetLike = asyncHandler(async (req, res) => {
    const { tweetId } = req.params;

    if (!isValidObjectId(tweetId)) {
        throw new ApiError(400, "Invalid tweet id");
    }

    const tweet = await Tweet.findById(tweetId);

    if (!tweet) {
        throw new ApiError(404, "Tweet not found");
    }

    const likedTweet = await Like.findOne({
        tweet: tweetId,
        likedBy: req.user._id
    });

    if (likedTweet) {
        await likedTweet.deleteOne();

        return res.status(200).json(
            new ApiResponse(
                200,
                {},
                "Tweet unliked successfully"
            )
        );
    }

    await Like.create({
        tweet: tweetId,
        likedBy: req.user._id
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            {},
            "Tweet liked successfully"
        )
    );
});

/**
 * GET /likes/videos — the videos the current user has liked.
 *
 * Response contract: ApiResponse.data is a FLAT ARRAY OF VIDEO DOCUMENTS, each
 * carrying `likedAt` (when this user liked it) plus the same derived fields the
 * other video listings expose (owner, likesCount, commentsCount, isLiked,
 * sourceType, externalVideoId).
 *
 * It previously returned an array of *Like* documents shaped
 * `{ _id: <likeId>, video: {...}, createdAt }`. Every consumer of this endpoint
 * renders video cards, so each card received a Like document: `_id` was the like's
 * id (making the "watch" link point at a non-existent video) and `title`,
 * `thumbnail` and `owner` were all undefined. Returning videos directly is what
 * the callers already assume, and it makes this endpoint agree with
 * GET /videos and GET /users/history.
 *
 * Two further problems are fixed by the `$match` after the `$lookup`:
 *
 *   1. A like whose video has since been deleted produced an entry with NO
 *      `video` key at all (`$first` of an empty array yields "missing"), so the
 *      list was padded with unrenderable placeholder objects. On the live
 *      database 39 of 43 video-likes are in exactly this state, which is why the
 *      page appeared broken/empty for most accounts.
 *   2. The inner `isPublished: true` filter had the same effect for unpublished
 *      videos.
 *
 * Those orphaned Like documents are deliberately left in the database — they are
 * user data and removing them is not this endpoint's job. They are simply not
 * returned, because there is no longer a video to show.
 */
const getLikedVideos = asyncHandler(async (req, res) => {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const likedVideos = await Like.aggregate([
        {
            $match: {
                likedBy: userId,
                video: { $exists: true, $ne: null }
            }
        },
        // Newest like first. Done before the lookups so the sort is cheap.
        { $sort: { createdAt: -1 } },
        {
            $lookup: {
                from: "videos",
                localField: "video",
                foreignField: "_id",
                as: "video",
                pipeline: [
                    {
                        $match: {
                            isPublished: true
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
                                        fullName: 1,
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
                    // Counts so the cards match what /videos returns.
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
                            // Every video in this list is, by definition, liked
                            // by the requesting user.
                            isLiked: true,
                            // Normalise the source for legacy documents here too,
                            // so every list that renders video cards agrees.
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
        // Drops likes whose video was deleted or unpublished, instead of emitting
        // an entry with a missing `video`.
        {
            $match: {
                "video.0": { $exists: true }
            }
        },
        // Flatten to the video document itself and record when it was liked.
        {
            $replaceWith: {
                $mergeObjects: [
                    { $first: "$video" },
                    { likedAt: "$createdAt" }
                ]
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            likedVideos,
            "Liked videos fetched successfully"
        )
    );
});

export {
    toggleCommentLike,
    toggleTweetLike,
    toggleVideoLike,
    getLikedVideos
}