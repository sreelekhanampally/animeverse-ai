import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, MoreVertical, Sparkles } from "lucide-react";
import { LazyImage } from "@/components/common/LazyImage";
import { Avatar } from "@/components/ui/Avatar";
import { formatViews, formatDuration, timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

/**
 * Backend-friendly shape (all optional):
 *  { _id, title, thumbnail, duration, views, createdAt, owner: { username, avatar, fullName } }
 */
export function VideoCard({ video, className, compact = false }) {
    if (!video) return null;

    const {
        _id,
        title,
        thumbnail,
        duration,
        views,
        createdAt,
        owner,
        isAiCurated,
    } = video;

    const to = `/watch/${_id}`;

    return (
        <motion.article
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2 }}
            className={cn("group flex flex-col gap-3", className)}
        >
            <Link
                to={to}
                className="relative block overflow-hidden rounded-2xl border border-white/5 bg-card/60 shadow-sm transition-shadow group-hover:shadow-xl"
            >
                <div className="relative aspect-video w-full">
                    <LazyImage
                        src={thumbnail}
                        alt={title || "Video thumbnail"}
                        wrapperClassName="absolute inset-0"
                        className="scale-100 transition-transform duration-500 group-hover:scale-[1.04]"
                    />

                    {/* Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-90" />

                    {/* Duration */}
                    {duration != null && (
                        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                            {formatDuration(duration)}
                        </span>
                    )}

                    {isAiCurated && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent backdrop-blur">
                            <Sparkles className="h-3 w-3" /> AI Pick
                        </span>
                    )}

                    {/* Play hover */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/90 shadow-glow">
                            <Play className="ml-0.5 h-6 w-6 text-white" fill="currentColor" />
                        </span>
                    </div>
                </div>
            </Link>

            {!compact && (
                <div className="flex items-start gap-3 px-1">
                    <Link to={owner?.username ? `/c/${owner.username}` : "#"} className="shrink-0">
                        <Avatar
                            size="sm"
                            src={owner?.avatar}
                            name={owner?.fullName || owner?.username}
                        />
                    </Link>
                    <div className="min-w-0 flex-1">
                        <Link to={to}>
                            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white transition-colors group-hover:text-accent">
                                {title || "Untitled"}
                            </h3>
                        </Link>
                        <div className="mt-1 truncate text-xs text-muted">
                            {owner?.fullName || owner?.username || "AnimeVerse Creator"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                            <span>{formatViews(views)} views</span>
                            {createdAt && (
                                <>
                                    <span className="h-1 w-1 rounded-full bg-muted/60" />
                                    <span>{timeAgo(createdAt)}</span>
                                </>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={(e) => e.preventDefault()}
                        className="rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                        aria-label="More options"
                    >
                        <MoreVertical className="h-4 w-4" />
                    </button>
                </div>
            )}
        </motion.article>
    );
}

export function VideoCardSkeleton({ compact = false }) {
    return (
        <div className="flex flex-col gap-3">
            <div className="skeleton aspect-video w-full rounded-2xl" />
            {!compact && (
                <div className="flex items-start gap-3 px-1">
                    <div className="skeleton h-8 w-8 rounded-full" />
                    <div className="flex-1 space-y-2">
                        <div className="skeleton h-3 w-[85%] rounded-md" />
                        <div className="skeleton h-3 w-[55%] rounded-md" />
                        <div className="skeleton h-2.5 w-[35%] rounded-md" />
                    </div>
                </div>
            )}
        </div>
    );
}
