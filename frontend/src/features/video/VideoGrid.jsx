import { VideoCard, VideoCardSkeleton } from "./VideoCard";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Film } from "lucide-react";

export function VideoGrid({
    videos,
    isLoading,
    error,
    onRetry,
    skeletonCount = 8,
    emptyTitle = "No videos yet",
    emptyMessage = "As new episodes drop and creators upload, they'll appear here.",
    columns = "default",
}) {
    const gridClass =
        columns === "dense"
            ? "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
            : "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

    if (error) {
        return (
            <ErrorState
                title="Couldn't load videos"
                message="We hit a snag while fetching this feed."
                onRetry={onRetry}
            />
        );
    }

    if (isLoading) {
        return (
            <div className={gridClass}>
                {Array.from({ length: skeletonCount }).map((_, i) => (
                    <VideoCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (!videos || videos.length === 0) {
        return <EmptyState icon={Film} title={emptyTitle} message={emptyMessage} />;
    }

    return (
        <div className={gridClass}>
            {videos.map((v) => (
                <VideoCard key={v._id || v.id} video={v} />
            ))}
        </div>
    );
}
