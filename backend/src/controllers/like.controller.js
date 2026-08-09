import mongoose, {isValidObjectId} from "mongoose"
import {Like} from "../models/like.model.js"
import { Comment } from "../models/comment.model.js";
import { Video } from "../models/video.model.js";
import { Tweet } from "../models/tweet.model.js";
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"

const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    const likedVideo = await Like.findOne({
        video: videoId,
        likedBy: req.user._id
    });

    if (likedVideo) {
        await likedVideo.deleteOne();

        return res.status(200).json(
            new ApiResponse(
                200,
                {},
                "Video unliked successfully"
            )
        );
    }

    await Like.create({
        video: videoId,
        likedBy: req.user._id
    });

    return res.status(201).json(
        new ApiResponse(
            201,
            {},
            "Video liked successfully"
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

const getLikedVideos = asyncHandler(async (req, res) => {
    const likedVideos = await Like.aggregate([
        {
            $match: {
                likedBy: new mongoose.Types.ObjectId(req.user._id),
                video: {
                    $exists: true
                }
            }
        },
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
                    {
                        $addFields: {
                            // Normalise the source for legacy documents here too,
                            // so every list that renders video cards agrees.
                            sourceType: { $ifNull: ["$sourceType", "cloudinary"] },
                            externalVideoId: { $ifNull: ["$externalVideoId", ""] }
                        }
                    },
                    {
                        $project: {
                            __v: 0,
                            embedding: 0
                        }
                    }
                ]
            }
        },
        {
            $addFields: {
                video: {
                    $first: "$video"
                }
            }
        },
        {
            $project: {
                likedBy: 0,
                comment: 0,
                tweet: 0,
                __v: 0
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