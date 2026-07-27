import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Film } from "lucide-react";
import { VideoCard, VideoCardSkeleton } from "./VideoCard";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";

export function InfiniteVideoGrid({
    query,
    skeletonCount = 8,
    emptyTitle = "No videos yet",
    emptyMessage = "As new episodes drop and creators upload, they'll appear here.",
}) {
    const {
        data,
        error,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
    } = query;

    const sentinelRef = useRef(null);
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { rootMargin: "400px" }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    if (error) {
        return (
            <ErrorState
                title="Couldn't load videos"
                message="We hit a snag while fetching this feed."
                onRetry={refetch}
            />
        );
    }

    const gridClass =
        "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

    if (isLoading) {
        return (
            <div className={gridClass}>
                {Array.from({ length: skeletonCount }).map((_, i) => (
                    <VideoCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    const videos = (data?.pages || []).flatMap((p) => p.items);

    if (videos.length === 0) {
        return <EmptyState icon={Film} title={emptyTitle} message={emptyMessage} />;
    }

    return (
        <div className="space-y-6">
            <div className={gridClass}>
                {videos.map((v, i) => (
                    <motion.div
                        key={v._id || v.id || i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.24, delay: (i % 8) * 0.02 }}
                    >
                        <VideoCard video={v} />
                    </motion.div>
                ))}
            </div>

            <div ref={sentinelRef} className="h-8 w-full" aria-hidden />
            {isFetchingNextPage && (
                <div className={gridClass}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <VideoCardSkeleton key={`nx-${i}`} />
                    ))}
                </div>
            )}
            {!hasNextPage && (
                <div className="pt-2 text-center text-xs text-muted">
                    You're all caught up.
                </div>
            )}
        </div>
    );
}
