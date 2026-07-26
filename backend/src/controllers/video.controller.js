import mongoose, { isValidObjectId } from "mongoose";
import { Video } from "../models/video.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from "../utils/cloudinary.js";
import { autoTagAndSummarize, embedText } from "../services/ai.service.js";


const getAllVideos = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        query,
        sortBy,
        sortType,
        userId
    } = req.query;

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.max(1, Number(limit) || 10);

    const matchStage = {
        isPublished: true
    };

    // Search
    if (query?.trim()) {
        matchStage.$or = [
            {
                title: {
                    $regex: query,
                    $options: "i"
                }
            },
            {
                description: {
                    $regex: query,
                    $options: "i"
                }
            }
        ];
    }

    // Filter by owner
    if (userId) {
        if (!isValidObjectId(userId)) {
            throw new ApiError(400, "Invalid user id");
        }

        matchStage.owner = new mongoose.Types.ObjectId(userId);
    }

    // Sorting
    const sortStage = {};

    if (sortBy) {
        sortStage[sortBy] = sortType === "asc" ? 1 : -1;
    } else {
        sortStage.createdAt = -1;
    }

    const aggregate = Video.aggregate([
        {
            $match: matchStage
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
            $lookup: {
                from: "subscriptions",
                localField: "owner._id",
                foreignField: "channel",
                as: "subscribers"
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
                subscribersCount: {
                    $size: "$subscribers"
                },
                isLiked: {
                    $cond: {
                        if: {
                            $ifNull: [req.user?._id, false]
                        },
                        then: {
                            $in: [
                                req.user._id,
                                "$likes.likedBy"
                            ]
                        },
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                likes: 0,
                comments: 0,
                subscribers: 0,
                __v: 0
            }
        },
        {
            $sort: sortStage
        }
    ]);

    const videos = await Video.aggregatePaginate(
        aggregate,
        {
            page: pageNumber,
            limit: limitNumber
        }
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            videos,
            "Videos fetched successfully"
        )
    );
});

const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    if (!title?.trim() || !description?.trim()) {
        throw new ApiError(400, "Title and description are required");
    }

    const videoLocalPath = req.files?.videoFile?.[0]?.path;
    const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;

    if (!videoLocalPath) {
        throw new ApiError(400, "Video file is required");
    }

    if (!thumbnailLocalPath) {
        throw new ApiError(400, "Thumbnail is required");
    }

    const uploadedVideo = await uploadOnCloudinary(videoLocalPath);

    if (!uploadedVideo?.secure_url) {
        throw new ApiError(500, "Failed to upload video");
    }

    const uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath);

    if (!uploadedThumbnail?.secure_url) {
        throw new ApiError(500, "Failed to upload thumbnail");
    }

    const video = await Video.create({
        title: title.trim(),
        description: description.trim(),
        videoFile: uploadedVideo.secure_url,
        thumbnail: uploadedThumbnail.secure_url,
        duration: uploadedVideo.duration || 0,
        owner: req.user._id,
        isPublished: true,
    });

    // Fire-and-forget AI enrichment: auto-tags, summary, embedding
    (async () => {
        try {
            const { tags, summary } = await autoTagAndSummarize({
                title: video.title,
                description: video.description,
            });
            const embedding = await embedText(`${video.title}\n${video.description}\n${tags.join(", ")}`);
            await Video.updateOne(
                { _id: video._id },
                { $set: { tags, aiSummary: summary, embedding } }
            );
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("AI enrichment failed:", e?.message);
        }
    })();

    const createdVideo = await Video.findById(video._id)
        .populate("owner", "username fullName avatar")
        .select("-__v");

    return res.status(201).json(
        new ApiResponse(
            201,
            createdVideo,
            "Video published successfully"
        )
    );
});

const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(videoId),
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
            $lookup: {
                from: "likes",
                localField: "_id",
                foreignField: "video",
                as: "likes"
            }
        },
        {
            $addFields: {
                likesCount: {
                    $size: "$likes"
                }
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
                commentsCount: {
                    $size: "$comments"
                }
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "owner._id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                }
            }
        },
        {
            $addFields: {
                isLiked: {
                    $cond: {
                        if: { $ifNull: [req.user?._id, false] },
                        then: {
                            $in: [req.user._id, "$likes.likedBy"]
                        },
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                likes: 0,
                comments: 0,
                subscribers: 0
            }
        }
    ]);

    if (!video.length) {
        throw new ApiError(404, "Video not found");
    }

    // Increment view + update user watch history (fire-and-forget)
    Video.updateOne({ _id: videoId }, { $inc: { views: 1 } }).catch(() => {});
    if (req.user?._id) {
        User.updateOne(
            { _id: req.user._id },
            {
                $pull: { watchHistory: new mongoose.Types.ObjectId(videoId) },
            }
        )
            .then(() =>
                User.updateOne(
                    { _id: req.user._id },
                    {
                        $push: {
                            watchHistory: {
                                $each: [new mongoose.Types.ObjectId(videoId)],
                                $position: 0,
                                $slice: 200,
                            },
                        },
                    }
                )
            )
            .catch(() => {});
    }

    return res.status(200).json(new ApiResponse(200, video[0], "Video fetched successfully"));
});

const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (!video.owner.equals(req.user._id)) {
    throw new ApiError(403, "You are not authorized to update this video");
    }

    const { title, description } = req.body;

    if (title?.trim()) {
        video.title = title.trim();
    }

    if (description?.trim()) {
        video.description = description.trim();
    }

    const thumbnailLocalPath = req.file?.path;
    let oldThumbnail = null;

    if (thumbnailLocalPath) {
        // Capture OLD thumbnail before swapping — critical bug fix
        oldThumbnail = video.thumbnail;

        const uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath);
        if (!uploadedThumbnail?.secure_url) {
            throw new ApiError(500, "Failed to upload thumbnail");
        }
        video.thumbnail = uploadedThumbnail.secure_url;
    }

    await video.save({ validateBeforeSave: false });

    if (oldThumbnail && oldThumbnail !== video.thumbnail) {
        await deleteFromCloudinary(getPublicIdFromUrl(oldThumbnail));
    }

    const updatedVideo = await Video.findById(videoId)
        .populate("owner", "username fullName avatar")
        .select("-__v");

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedVideo,
            "Video updated successfully"
        )
    );
});

const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (!video.owner.equals(req.user._id)) {
        throw new ApiError(403, "You are not authorized to delete this video");
    }

    const videoPublicId = getPublicIdFromUrl(video.videoFile);
    const thumbnailPublicId = getPublicIdFromUrl(video.thumbnail);

    await deleteFromCloudinary(videoPublicId, "video");
    await deleteFromCloudinary(thumbnailPublicId);

    await video.deleteOne();

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Video deleted successfully"
        )
    );
});

const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    if (!isValidObjectId(videoId)) {
        throw new ApiError(400, "Invalid video id");
    }

    const video = await Video.findById(videoId);

    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    if (!video.owner.equals(req.user._id)) {
        throw new ApiError(403, "You are not authorized to update this video");
    }

    video.isPublished = !video.isPublished;

    await video.save({ validateBeforeSave: false });

    const updatedVideo = await Video.findById(videoId)
    .populate("owner","username fullName avatar");

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedVideo,
            `Video ${video.isPublished ? "published" : "unpublished"} successfully`
        )
    );
});

export {
    getAllVideos,
    publishAVideo,
    getVideoById,
    updateVideo,
    deleteVideo,
    togglePublishStatus
};