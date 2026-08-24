import { Video } from "../models/video.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Public, platform-wide counters for the homepage hero.
 *
 * Deliberately separate from GET /dashboard/stats: that endpoint is per-creator
 * and sits behind verifyJWT, while the hero renders for guests too. Reusing it
 * would have meant either widening its auth or showing one creator's totals as
 * if they were the platform's.
 *
 * Both figures are scoped to `isPublished: true` — the same visibility rule
 * GET /videos applies to public listings. A visitor reading "83 videos" should be
 * able to go and find those 83 videos; counting drafts would overstate the
 * catalogue and the two numbers would disagree with the grids below the hero.
 */
const getPlatformStats = asyncHandler(async (req, res) => {
    const publishedMatch = { isPublished: true };

    /**
     * Unique uploaders, computed entirely inside MongoDB.
     *
     * $group runs before $lookup on purpose: it collapses the collection down to
     * one document per distinct owner first, so the users join then runs over a
     * handful of ids instead of once per video. Ordering it the other way would
     * join every video document.
     *
     * The join itself is what makes this a count of real users rather than of
     * raw owner ids — an id left behind by a since-removed User contributes
     * nothing. `owner: { $ne: null }` drops documents with no uploader at all
     * (the schema does not require `owner`), which would otherwise group
     * together into a phantom "null creator".
     */
    const creatorsAgg = await Video.aggregate([
        { $match: { ...publishedMatch, owner: { $ne: null } } },
        { $group: { _id: "$owner" } },
        {
            $lookup: {
                from: "users",
                localField: "_id",
                foreignField: "_id",
                as: "user",
                // Nothing from the user document is needed, only its existence.
                pipeline: [{ $project: { _id: 1 } }],
            },
        },
        { $match: { "user.0": { $exists: true } } },
        { $count: "creatorsCount" },
    ]);

    // countDocuments, not find().length: the server returns a number and no
    // document ever crosses the wire.
    const videosCount = await Video.countDocuments(publishedMatch);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                videosCount,
                // $count emits no document at all for an empty collection.
                creatorsCount: creatorsAgg[0]?.creatorsCount || 0,
            },
            "Platform stats fetched successfully"
        )
    );
});

export { getPlatformStats };
