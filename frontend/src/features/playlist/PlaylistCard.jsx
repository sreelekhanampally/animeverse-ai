import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ListVideo, Lock, Globe2 } from "lucide-react";
import { LazyImage } from "@/components/common/LazyImage";
import { timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

export function PlaylistCard({ playlist, className }) {
    if (!playlist) return null;
    const { _id, name, description, videos = [], updatedAt, createdAt, isPublic } = playlist;
    const count = videos?.length ?? playlist.videoCount ?? 0;
    const firstThumb = playlist.thumbnail || videos?.[0]?.thumbnail;

    return (
        <motion.article whileHover={{ y: -3 }} className={cn("group", className)}>
            <Link
                to={`/playlists/${_id}`}
                className="block overflow-hidden rounded-2xl border border-white/5 bg-card/60 backdrop-blur transition-shadow group-hover:shadow-xl"
            >
                <div className="relative aspect-video w-full">
                    {firstThumb ? (
                        <LazyImage
                            src={firstThumb}
                            alt={name}
                            wrapperClassName="absolute inset-0"
                            className="transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-accent/25" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                    <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                        <ListVideo className="h-3 w-3" /> {count}
                    </div>
                    <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
                        <h3 className="line-clamp-2 pr-2 font-display text-base font-semibold text-white">
                            {name}
                        </h3>
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                            {isPublic === false ? (
                                <>
                                    <Lock className="h-3 w-3" /> Private
                                </>
                            ) : (
                                <>
                                    <Globe2 className="h-3 w-3" /> Public
                                </>
                            )}
                        </span>
                    </div>
                </div>
                <div className="px-4 py-3 text-xs text-muted">
                    <p className="line-clamp-1">{description || "No description yet."}</p>
                    <div className="mt-1 text-[11px]">Updated {timeAgo(updatedAt || createdAt)}</div>
                </div>
            </Link>
        </motion.article>
    );
}

export function PlaylistCardSkeleton() {
    return (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-card/60">
            <div className="skeleton aspect-video w-full" />
            <div className="space-y-2 px-4 py-3">
                <div className="skeleton h-3 w-3/4 rounded" />
                <div className="skeleton h-2.5 w-1/2 rounded" />
            </div>
        </div>
    );
}
