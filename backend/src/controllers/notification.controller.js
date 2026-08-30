import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { Video } from "../models/video.model.js";
import { Like } from "../models/like.model.js";
import { Comment } from "../models/comment.model.js";
import { Subscription } from "../models/subscription.model.js";
import { CommunityPost, FanClub } from "../models/community.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * The notification feed behind the navbar bell.
 *
 * There is no Notification collection in this project, and this endpoint
 * deliberately does not add one. Notifications are DERIVED on read from the
 * collections that already record the underlying events — likes, comments,
 * subscriptions, videos and community posts.
 *
 * Why derive rather than store:
 *   - Writing notification rows would mean editing the like, comment,
 *     subscription, video and community controllers. Those are the hot paths for
 *     features that already work; a bug in any of them breaks liking or
 *     commenting outright. This endpoint touches no write path at all.
 *   - Events that happened before this feature existed still show up, so the
 *     tray is not empty on day one and needs no backfill migration.
 *
 * The trade-off, stated plainly: this is a read-time aggregation with no
 * per-notification read/dismiss state. Unread is derived from a single
 * `notificationsLastReadAt` timestamp on the user. That is the honest limit of a
 * derived feed — per-item state would require the stored collection above.
 *
 * Every category is gated on the user's own notificationPreferences: a disabled
 * category is not queried at all, so the switches in Settings genuinely control
 * both the feed and the unread count rather than only hiding rows in the UI.
 */

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

/** Mirrors the schema default so a missing key reads as enabled. */
const isEnabled = (prefs, key) => (prefs?.[key] === undefined ? true : !!prefs[key]);

/**
 * Only the current user's own videos, as ids. Used to scope "someone liked /
 * commented on your video" without trusting anything from the request.
 */
const ownVideoIds = async (userId) => {
    const rows = await Video.find({ owner: userId }).select("_id").lean();
    return rows.map((r) => r._id);
};

const getNotifications = asyncHandler(async (req, res) => {
    // Identity comes from verifyJWT's decoded token only.
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT)
    );

    const me = await User.findById(userId)
        .select("notificationPreferences notificationsLastReadAt")
        .lean();

    if (!me) {
        throw new ApiError(404, "User not found");
    }

    const prefs = me.notificationPreferences || {};
    const lastReadAt = me.notificationsLastReadAt
        ? new Date(me.notificationsLastReadAt)
        : null;

    /**
     * Each enabled category contributes at most `limit` rows; the merged list is
     * re-sorted and truncated to `limit` at the end. Fetching `limit` per source
     * rather than everything keeps the work bounded regardless of history size.
     */
    const tasks = [];

    // --- Likes on the user's own videos ---
    if (isEnabled(prefs, "likes")) {
        tasks.push(
            (async () => {
                const videoIds = await ownVideoIds(userId);
                if (!videoIds.length) return [];

                const rows = await Like.find({
                    video: { $in: videoIds },
                    // A creator liking their own video is not a notification.
                    likedBy: { $ne: userId },
                })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .populate("likedBy", "username fullName avatar")
                    .populate("video", "title")
                    .lean();

                return rows
                    // A like whose user or video was since deleted has nothing to show.
                    .filter((r) => r.likedBy && r.video)
                    .map((r) => ({
                        id: `like:${r._id}`,
                        type: "likes",
                        createdAt: r.createdAt,
                        actor: r.likedBy,
                        text: `liked your video "${r.video.title}"`,
                        videoId: r.video._id,
                    }));
            })()
        );
    }

    // --- Comments on the user's own videos ---
    if (isEnabled(prefs, "comments")) {
        tasks.push(
            (async () => {
                const videoIds = await ownVideoIds(userId);
                if (!videoIds.length) return [];

                const rows = await Comment.find({
                    video: { $in: videoIds },
                    owner: { $ne: userId }, // ignore the creator's own comments
                })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .populate("owner", "username fullName avatar")
                    .populate("video", "title")
                    .lean();

                return rows
                    .filter((r) => r.owner && r.video)
                    .map((r) => ({
                        id: `comment:${r._id}`,
                        type: "comments",
                        createdAt: r.createdAt,
                        actor: r.owner,
                        text: `commented on "${r.video.title}"`,
                        videoId: r.video._id,
                    }));
            })()
        );
    }

    // --- New subscribers to the user's channel ---
    if (isEnabled(prefs, "subscribers")) {
        tasks.push(
            (async () => {
                const rows = await Subscription.find({ channel: userId })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .populate("subscriber", "username fullName avatar")
                    .lean();

                return rows
                    .filter((r) => r.subscriber)
                    .map((r) => ({
                        id: `sub:${r._id}`,
                        type: "subscribers",
                        createdAt: r.createdAt,
                        actor: r.subscriber,
                        text: "subscribed to your channel",
                    }));
            })()
        );
    }

    // --- Uploads from channels the user subscribes to ---
    if (isEnabled(prefs, "uploads")) {
        tasks.push(
            (async () => {
                const subs = await Subscription.find({ subscriber: userId })
                    .select("channel")
                    .lean();
                const channelIds = subs.map((s) => s.channel).filter(Boolean);
                if (!channelIds.length) return [];

                const rows = await Video.find({
                    owner: { $in: channelIds },
                    // Same visibility rule as the public listings.
                    isPublished: true,
                })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .select("title owner createdAt")
                    .populate("owner", "username fullName avatar")
                    .lean();

                return rows
                    .filter((r) => r.owner)
                    .map((r) => ({
                        id: `upload:${r._id}`,
                        type: "uploads",
                        createdAt: r.createdAt,
                        actor: r.owner,
                        text: `uploaded "${r.title}"`,
                        videoId: r._id,
                    }));
            })()
        );
    }

    // --- New posts in fan clubs the user belongs to ---
    if (isEnabled(prefs, "community")) {
        tasks.push(
            (async () => {
                const clubs = await FanClub.find({ members: userId })
                    .select("_id name")
                    .lean();
                if (!clubs.length) return [];

                const clubNameById = new Map(
                    clubs.map((c) => [c._id.toString(), c.name])
                );

                const rows = await CommunityPost.find({
                    fanClub: { $in: clubs.map((c) => c._id) },
                    author: { $ne: userId }, // not the user's own posts
                })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .select("title author fanClub createdAt")
                    .populate("author", "username fullName avatar")
                    .lean();

                return rows
                    .filter((r) => r.author)
                    .map((r) => ({
                        id: `post:${r._id}`,
                        type: "community",
                        createdAt: r.createdAt,
                        actor: r.author,
                        text: `posted "${r.title}" in ${
                            clubNameById.get(r.fanClub?.toString()) || "a fan club"
                        }`,
                    }));
            })()
        );
    }

    // One slow/failed category must not blank the whole tray.
    const settled = await Promise.allSettled(tasks);
    const items = settled
        .filter((s) => s.status === "fulfilled")
        .flatMap((s) => s.value);

    for (const s of settled) {
        if (s.status === "rejected") {
            // eslint-disable-next-line no-console
            console.error("[notifications] category failed:", s.reason?.message);
        }
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const trimmed = items.slice(0, limit);

    // Unread = newer than the last time the tray was opened. With no timestamp
    // (never opened) everything currently visible counts as unread.
    const withRead = trimmed.map((n) => ({
        ...n,
        isUnread: !lastReadAt || new Date(n.createdAt) > lastReadAt,
    }));

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                notifications: withRead,
                unreadCount: withRead.filter((n) => n.isUnread).length,
                lastReadAt,
            },
            "Notifications fetched Successfully"
        )
    );
});

export { getNotifications };
