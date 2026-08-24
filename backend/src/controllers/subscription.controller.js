import mongoose, {isValidObjectId} from "mongoose"
import {User} from "../models/user.model.js"
import { Video } from "../models/video.model.js"
import { Subscription } from "../models/subscription.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"


const toggleSubscription = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) {
        throw new ApiError(400, "Invalid channel id");
    }

    if (channelId === req.user._id.toString()) {
        throw new ApiError(400, "You cannot subscribe to yourself");
    }

    const channel = await User.findById(channelId);

    if (!channel) {
        throw new ApiError(404, "Channel not found");
    }

    // Atomic toggle. The previous version read with findOne() and then wrote,
    // so two concurrent requests could both see "not subscribed" and both
    // insert. deleteOne() reports whether it actually removed anything, so the
    // decision and the write happen in a single operation.
    const { deletedCount } = await Subscription.deleteOne({
        subscriber: req.user._id,
        channel: channelId
    });

    let isSubscribed;

    if (deletedCount > 0) {
        isSubscribed = false;
    } else {
        try {
            await Subscription.create({
                subscriber: req.user._id,
                channel: channelId
            });
        } catch (error) {
            // 11000 = duplicate key on the unique (subscriber, channel) index.
            // Another in-flight request already created it, so the user is
            // subscribed either way — that is not an error worth surfacing.
            if (error?.code !== 11000) throw error;
        }
        isSubscribed = true;
    }

    // Recount from the collection so the client can trust this number instead
    // of maintaining its own counter.
    const subscribersCount = await Subscription.countDocuments({
        channel: channelId
    });

    return res.status(isSubscribed ? 201 : 200).json(
        new ApiResponse(
            isSubscribed ? 201 : 200,
            { isSubscribed, subscribersCount },
            isSubscribed
                ? "Channel subscribed successfully"
                : "Channel unsubscribed successfully"
        )
    );
});

// controller to return subscriber list of a channel
const getUserChannelSubscribers = asyncHandler(async (req, res) => {
    const { channelId } = req.params;

    if (!isValidObjectId(channelId)) {
        throw new ApiError(400, "Invalid channel id");
    }

    const channel = await User.findById(channelId);

    if (!channel) {
        throw new ApiError(404, "Channel not found");
    }

    const subscribers = await Subscription.aggregate([
        {
            $match: {
                channel: new mongoose.Types.ObjectId(channelId)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriber",
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
                subscriber: {
                    $first: "$subscriber"
                }
            }
        },
        {
            $project: {
                channel: 0,
                __v: 0
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            subscribers,
            "Subscribers fetched successfully"
        )
    );
});

// controller to return channel list to which user has subscribed
const getSubscribedChannels = asyncHandler(async (req, res) => {
    const { subscriberId } = req.params;

    if (!isValidObjectId(subscriberId)) {
        throw new ApiError(400, "Invalid subscriber id");
    }

    const user = await User.findById(subscriberId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const subscribedChannels = await Subscription.aggregate([
        {
            $match: {
                subscriber: new mongoose.Types.ObjectId(subscriberId)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "channel",
                foreignField: "_id",
                as: "channel",
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
                channel: {
                    $first: "$channel"
                }
            }
        },
        {
            $project: {
                subscriber: 0,
                __v: 0
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            subscribedChannels,
            "Subscribed channels fetched successfully"
        )
    );
});

/**
 * GET /subscriptions/feed — videos published by the channels the current user
 * subscribes to, newest first.
 *
 * The Subscriptions page needs "videos from my channels", and no endpoint
 * produced that. The only alternatives were to fetch the channel list and then
 * issue one GET /videos?userId=… per channel (N+1 requests, no correct global
 * ordering, no pagination), or to leave the page empty — which is what it did.
 *
 * The subscription relationship is read in the direction the existing model
 * already defines: `subscriber` = the viewer, `channel` = the creator. The model
 * is unchanged.
 *
 * Response contract: paginated, identical envelope to GET /videos
 * (`{ docs, totalDocs, page, totalPages, hasNextPage, ... }`) so the frontend can
 * reuse its existing pagination unwrapper and video cards.
 */
const getSubscribedChannelVideos = asyncHandler(async (req, res) => {
    const { page = 1, limit = 12 } = req.query;

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(50, Math.max(1, Number(limit) || 12));

    const userId = new mongoose.Types.ObjectId(req.user._id);

    // The channels this user subscribes to. Read as ids only — the video
    // documents carry their own populated owner further down.
    const subscriptions = await Subscription.find({ subscriber: userId })
        .select("channel")
        .lean();

    const channelIds = subscriptions.map((s) => s.channel);

    // No subscriptions -> an empty page in the same envelope, rather than a
    // special-cased response the client would have to detect.
    if (!channelIds.length) {
        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    docs: [],
                    totalDocs: 0,
                    limit: limitNumber,
                    page: pageNumber,
                    totalPages: 0,
                    hasNextPage: false,
                    hasPrevPage: false,
                    nextPage: null,
                    prevPage: null
                },
                "Subscription feed fetched successfully"
            )
        );
    }

    const aggregate = Video.aggregate([
        {
            $match: {
                owner: { $in: channelIds },
                isPublished: true
            }
        },
        { $sort: { createdAt: -1 } },
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
                // Every video here belongs to a channel the viewer subscribes to,
                // so the owner's state is known without another lookup.
                owner: {
                    $mergeObjects: ["$owner", { isSubscribed: true }]
                },
                // Same legacy-document normalisation as the other video listings.
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
    ]);

    const videos = await Video.aggregatePaginate(aggregate, {
        page: pageNumber,
        limit: limitNumber
    });

    return res.status(200).json(
        new ApiResponse(200, videos, "Subscription feed fetched successfully")
    );
});

export {
    toggleSubscription,
    getUserChannelSubscribers,
    getSubscribedChannels,
    getSubscribedChannelVideos
}