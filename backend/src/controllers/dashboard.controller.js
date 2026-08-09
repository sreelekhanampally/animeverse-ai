import mongoose from "mongoose"
import {Video} from "../models/video.model.js"
import {Subscription} from "../models/subscription.model.js"
import {Like} from "../models/like.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"

const getChannelStats = asyncHandler(async (req, res) => {

    const ownerId = req.user._id;

    const stats = await Video.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(ownerId)
            }
        },
        {
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $group: {
                _id: null,
                totalVideos: {
                    $sum: 1
                },
                totalViews: {
                    $sum: "$views"
                },
                totalLikes: {
                    $sum: {
                        $size: "$likes"
                    }
                }
            }
        }
    ]);

    const totalSubscribers = await Subscription.countDocuments({
        channel: ownerId
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                totalVideos: stats[0]?.totalVideos || 0,
                totalViews: stats[0]?.totalViews || 0,
                totalLikes: stats[0]?.totalLikes || 0,
                totalSubscribers
            },
            "Channel stats fetched successfully"
        )
    );
});

const getChannelVideos = asyncHandler(async (req, res) => {

    const videos = await Video.aggregate([
        {
            $match: {
                owner: new mongoose.Types.ObjectId(req.user._id)
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
                likesCount: {
                    $size: "$likes"
                },
                commentsCount: {
                    $size: "$comments"
                },
                // Same normalisation as the video controller so the dashboard
                // reports a source for legacy documents too (a Mongoose default
                // does not backfill aggregation output).
                sourceType: { $ifNull: ["$sourceType", "cloudinary"] },
                externalVideoId: { $ifNull: ["$externalVideoId", ""] }
            }
        },
        {
            $project: {
                likes: 0,
                comments: 0,
                __v: 0,
                // `select: false` on the schema does not apply to aggregation, so
                // this internal vector was being returned to the client.
                embedding: 0
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            videos,
            "Channel videos fetched successfully"
        )
    );
});

export {
    getChannelStats, 
    getChannelVideos
    }