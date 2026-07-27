import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, X } from "lucide-react";
import { LazyImage } from "@/components/common/LazyImage";
import { formatDuration, timeAgo } from "@/utils/format";

export function ContinueWatchingCard({ video, progress = 0.35, onRemove }) {
    if (!video) return null;
    const { _id, title, thumbnail, duration, updatedAt, createdAt, owner } = video;
    const to = `/watch/${_id}`;
    const pct = Math.min(100, Math.max(4, Math.round((progress || 0) * 100)));

    return (
        <motion.div whileHover={{ y: -3 }} className="group relative overflow-hidden rounded-2xl border border-white/5 bg-card/70 backdrop-blur">
            <Link to={to} className="block">
                <div className="relative aspect-video w-full">
                    <LazyImage
                        src={thumbnail}
                        alt={title}
                        wrapperClassName="absolute inset-0"
                        className="transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/90 shadow-glow">
                            <Play className="ml-0.5 h-6 w-6 text-white" fill="currentColor" />
                        </span>
                    </div>
                    {duration != null && (
                        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                            {formatDuration(duration)}
                        </span>
                    )}
                    {/* Progress bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                        <div
                            className="h-full bg-gradient-to-r from-primary to-accent shadow-glow"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
                <div className="p-3">
                    <h3 className="line-clamp-1 text-sm font-semibold text-white">{title}</h3>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted">
                        <span className="truncate">
                            {owner?.fullName || owner?.username || "AnimeVerse Creator"}
                        </span>
                        <span>{timeAgo(updatedAt || createdAt)}</span>
                    </div>
                </div>
            </Link>
            {onRemove && (
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        onRemove(video);
                    }}
                    className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/50 p-1.5 text-white/85 opacity-0 backdrop-blur transition hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
                    aria-label="Remove from history"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </motion.div>
    );
}
