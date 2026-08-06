import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, Play, X, Clock, Sparkles } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { LazyImage } from "@/components/common/LazyImage";
import { VideoRow } from "@/features/video/VideoRow";
import { ContinueWatchingCard } from "@/features/video/ContinueWatchingCard";
import {
    useWatchHistory,
    useRemoveFromHistory,
    useClearHistory,
} from "@/features/video/hooks";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { formatDuration, formatViews, timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

/* Group history entries by "today / yesterday / this week / earlier" */
function bucketOf(dateLike) {
    if (!dateLike) return "Earlier";
    const d = new Date(dateLike);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - 86400000;
    const startWeek = startToday - 6 * 86400000;
    const t = d.getTime();
    if (t >= startToday) return "Today";
    if (t >= startYesterday) return "Yesterday";
    if (t >= startWeek) return "This week";
    return "Earlier";
}

export default function HistoryPage() {
    const toast = useToast();
    const { data, isLoading, error, refetch } = useWatchHistory();
    const removeMut = useRemoveFromHistory();
    const clearMut = useClearHistory();
    const [confirmClear, setConfirmClear] = useState(false);

    const videos = data || [];
    const recentlyWatched = videos.slice(0, 10);

    const grouped = useMemo(() => {
        const map = new Map();
        for (const v of videos) {
            const key = bucketOf(v?.watchedAt || v?.updatedAt || v?.createdAt);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(v);
        }
        return Array.from(map.entries());
    }, [videos]);

    const onRemove = async (video) => {
        const id = video?._id || video?.videoId;
        if (!id) return;
        try {
            await removeMut.mutateAsync(id);
            toast.success("Removed from history");
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't remove from history"));
        }
    };

    const onClear = async () => {
        try {
            await clearMut.mutateAsync();
            toast.success("Watch history cleared");
            setConfirmClear(false);
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't clear history"));
        }
    };

    if (error) {
        return (
            <ErrorState
                title="Couldn't load your history"
                message="We hit a snag while pulling your watch history."
                onRetry={refetch}
            />
        );
    }

    return (
        <div className="space-y-8">
            <SectionHeader
                icon={History}
                title="Watch history"
                subtitle="Everything you've watched — pick up where you left off."
                action={
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmClear(true)}
                        disabled={isLoading || videos.length === 0 || clearMut.isPending}
                        className="text-rose-300 hover:!bg-rose-500/10"
                    >
                        <Trash2 className="h-4 w-4" /> Clear history
                    </Button>
                }
            />

            {/* Recently watched — horizontal row of Continue Watching cards */}
            <section className="space-y-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent" />
                    <h2 className="font-display text-lg font-semibold text-white">
                        Continue watching
                    </h2>
                </div>
                <VideoRow
                    videos={recentlyWatched}
                    isLoading={isLoading}
                    skeletonCount={5}
                    emptyIcon={History}
                    emptyTitle="Nothing to resume"
                    emptyMessage="Play something to see it appear here."
                    renderCard={(v) => (
                        <ContinueWatchingCard
                            video={v}
                            progress={v?.progress || 0.35}
                            onRemove={onRemove}
                        />
                    )}
                />
            </section>

            {/* Full history list grouped by bucket */}
            <section className="space-y-6">
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-accent" />
                    <h2 className="font-display text-lg font-semibold text-white">
                        Full history
                    </h2>
                </div>

                {isLoading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
                        ))}
                    </div>
                ) : videos.length === 0 ? (
                    <EmptyState
                        icon={History}
                        title="Nothing in your history"
                        message="Videos you watch appear here for easy rewinds."
                    />
                ) : (
                    <div className="space-y-8">
                        {grouped.map(([bucket, list]) => (
                            <div key={bucket} className="space-y-2">
                                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted">
                                    <span className="h-px flex-1 bg-white/10" />
                                    <span>{bucket}</span>
                                    <span className="h-px flex-1 bg-white/10" />
                                </div>
                                <AnimatePresence initial={false}>
                                    {list.map((v) => (
                                        <motion.div
                                            key={v._id}
                                            layout
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, x: 20 }}
                                            className="group flex items-center gap-3 rounded-2xl border border-white/5 bg-card/60 p-2 pr-3 backdrop-blur transition hover:bg-card/80"
                                        >
                                            <Link
                                                to={`/watch/${v._id}`}
                                                className="relative aspect-video w-44 shrink-0 overflow-hidden rounded-xl bg-black/60"
                                            >
                                                <LazyImage
                                                    src={v.thumbnail}
                                                    alt={v.title}
                                                    wrapperClassName="absolute inset-0"
                                                    className="transition-transform duration-500 group-hover:scale-[1.04]"
                                                />
                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/90 shadow-glow">
                                                        <Play
                                                            className="ml-0.5 h-4 w-4 text-white"
                                                            fill="currentColor"
                                                        />
                                                    </span>
                                                </div>
                                                {v.duration != null && (
                                                    <span className="absolute bottom-1 right-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                                                        {formatDuration(v.duration)}
                                                    </span>
                                                )}
                                            </Link>
                                            <div className="min-w-0 flex-1">
                                                <Link
                                                    to={`/watch/${v._id}`}
                                                    className="line-clamp-2 text-sm font-semibold text-white hover:text-accent"
                                                >
                                                    {v.title || "Untitled"}
                                                </Link>
                                                <div className="mt-0.5 truncate text-[11px] text-muted">
                                                    {v.owner?.fullName ||
                                                        v.owner?.username ||
                                                        "AnimeVerse Creator"}
                                                </div>
                                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                                                    <span>{formatViews(v.views)} views</span>
                                                    <span className="h-1 w-1 rounded-full bg-muted/60" />
                                                    <span>
                                                        Watched{" "}
                                                        {timeAgo(
                                                            v.watchedAt ||
                                                                v.updatedAt ||
                                                                v.createdAt
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => onRemove(v)}
                                                className={cn(
                                                    "rounded-lg p-2 text-muted opacity-0 transition hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100",
                                                    removeMut.isPending && "opacity-100"
                                                )}
                                                aria-label="Remove from history"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <ConfirmDialog
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                onConfirm={onClear}
                loading={clearMut.isPending}
                title="Clear your watch history?"
                message="This removes every video from your history. You can't undo this."
                confirmText="Clear history"
                danger
            />
        </div>
    );
}