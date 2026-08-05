import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BadgeCheck } from "lucide-react";
import { LazyImage } from "@/components/common/LazyImage";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDuration, formatViews, timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

export function SuggestedVideoRow({ video, className }) {
    if (!video) return null;
    const { _id, title, thumbnail, duration, views, createdAt, owner } = video;
    const isVerified = owner?.verified || owner?.isVerified;
    return (
        <motion.div whileHover={{ x: 2 }} className={cn("group", className)}>
            <Link to={`/watch/${_id}`} className="flex gap-3">
                <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-xl bg-black/50">
                    <LazyImage
                        src={thumbnail}
                        alt={title}
                        wrapperClassName="absolute inset-0"
                        className="transition-transform duration-500 group-hover:scale-[1.05]"
                    />
                    {duration != null && (
                        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {formatDuration(duration)}
                        </span>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="line-clamp-2 text-sm font-semibold text-white transition-colors group-hover:text-accent">
                        {title || "Untitled"}
                    </h4>
                    <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted">
                        <span className="truncate">
                            {owner?.fullName || owner?.username || "AnimeVerse Creator"}
                        </span>
                        {isVerified && <BadgeCheck className="h-3 w-3 text-accent" />}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                        {formatViews(views)} views {createdAt && `· ${timeAgo(createdAt)}`}
                    </div>
                </div>
            </Link>
        </motion.div>
    );
}

export function SuggestedVideoSkeleton() {
    return (
        <div className="flex gap-3">
            <Skeleton className="aspect-video w-40 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-[85%]" />
                <Skeleton className="h-2.5 w-[60%]" />
                <Skeleton className="h-2.5 w-[40%]" />
            </div>
        </div>
    );
}
