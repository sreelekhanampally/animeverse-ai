import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, Play, X, Clock } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { LazyImage } from "@/components/common/LazyImage";
import {
    useWatchHistory,
    useRemoveFromHistory,
    useClearHistory,
} from "@/features/video/hooks";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { formatDuration, formatViews } from "@/utils/format";
import { cn } from "@/utils/cn";

export default function HistoryPage() {
    const toast = useToast();
    const { data, isLoading, error, refetch } = useWatchHistory();
    const removeMut = useRemoveFromHistory();
    const clearMut = useClearHistory();
    const [confirmClear, setConfirmClear] = useState(false);

    // The backend preserves User.watchHistory order exactly: newest opened video
    // first. We deliberately do NOT group by video.updatedAt/createdAt because
    // those are publication timestamps, not watch timestamps.
    const videos = data || [];

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
                subtitle="Most recently watched first, with older videos following below."
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

            <section className="space-y-6">
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-accent" />
                    <h2 className="font-display text-lg font-semibold text-white">
                        Most recent → older
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
                        message="Videos you watch appear here in recency order."
                    />
                ) : (
                    <div className="space-y-2">
                        <AnimatePresence initial={false}>
                            {videos.map((v, index) => (
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
                                                <Play className="ml-0.5 h-4 w-4 text-white" fill="currentColor" />
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
                                            {v.owner?.fullName || v.owner?.username || "AnimeVerse Creator"}
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                                            <span>{formatViews(v.views)} views</span>
                                            <span className="h-1 w-1 rounded-full bg-muted/60" />
                                            <span>{index === 0 ? "Most recent" : `History #${index + 1}`}</span>
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
