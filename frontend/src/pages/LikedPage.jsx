import { ThumbsUp } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { VideoGrid } from "@/features/video/VideoGrid";
import { useLikedVideos } from "@/features/video/hooks";

/**
 * Liked Videos.
 *
 * This page previously rendered a hardcoded <EmptyState title="No likes yet" />
 * and never called the API at all — which is why it reported no likes regardless
 * of what was in the database. The backend endpoint and the useLikedVideos hook
 * both already existed; nothing consumed them.
 *
 * It now reads GET /likes/videos through that hook, so the list comes from
 * MongoDB on first paint and on every reload. Liking or unliking a video
 * elsewhere invalidates the same query key, so this list stays current without a
 * manual refresh. No localStorage, no client-side source of truth.
 *
 * Rendering reuses the existing VideoGrid/VideoCard — no new card design.
 */
export default function LikedPage() {
    const { data, isLoading, error, refetch } = useLikedVideos();

    const videos = data || [];

    if (error) {
        return (
            <div className="space-y-6">
                <SectionHeader
                    icon={ThumbsUp}
                    title="Liked videos"
                    subtitle="Everything you gave a thumbs-up."
                />
                <ErrorState
                    title="Couldn't load your liked videos"
                    message="We hit a snag while pulling the videos you've liked."
                    onRetry={refetch}
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={ThumbsUp}
                title="Liked videos"
                subtitle={
                    isLoading || videos.length === 0
                        ? "Everything you gave a thumbs-up."
                        : `${videos.length.toLocaleString()} video${
                              videos.length === 1 ? "" : "s"
                          } you gave a thumbs-up.`
                }
            />

            {!isLoading && videos.length === 0 ? (
                <EmptyState
                    icon={ThumbsUp}
                    title="No likes yet"
                    message="Like a video and it will appear in this list."
                />
            ) : (
                <VideoGrid
                    videos={videos}
                    isLoading={isLoading}
                    error={error}
                    onRetry={refetch}
                    emptyTitle="No likes yet"
                    emptyMessage="Like a video and it will appear in this list."
                />
            )}
        </div>
    );
}
