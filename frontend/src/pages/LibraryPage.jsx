import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { VideoGrid } from "@/features/video/VideoGrid";
import { useCommentedVideos } from "@/features/video/hooks";

/**
 * Library — the videos the current user has commented on.
 *
 * Backed by GET /comments/user/videos, which derives the list from the existing
 * `comments` collection (a comment already references both its owner and its
 * video). Consequences that fall out of that, rather than needing client logic:
 *
 *   - a video appears exactly once however many times the user commented on it,
 *     because the server groups by video;
 *   - deleting the user's last comment on a video removes it from this list,
 *     while deleting one of several comments leaves it in place;
 *   - the list is correct for comments that already existed before this page
 *     did, since nothing extra has to be recorded at comment time.
 *
 * Posting or deleting a comment invalidates this page's query key, so it updates
 * without a browser refresh, and a reload re-reads it from MongoDB.
 */
export default function LibraryPage() {
    const { data, isLoading, error, refetch } = useCommentedVideos();

    const videos = data || [];

    if (error) {
        return (
            <div className="space-y-6">
                <SectionHeader
                    icon={MessageSquare}
                    title="Library"
                    subtitle="Videos you've joined the conversation on."
                />
                <ErrorState
                    title="Couldn't load your library"
                    message="We hit a snag while pulling the videos you've commented on."
                    onRetry={refetch}
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={MessageSquare}
                title="Library"
                subtitle={
                    isLoading || videos.length === 0
                        ? "Videos you've joined the conversation on."
                        : `${videos.length.toLocaleString()} video${
                              videos.length === 1 ? "" : "s"
                          } you've commented on.`
                }
            />

            {!isLoading && videos.length === 0 ? (
                <EmptyState
                    icon={MessageSquare}
                    title="No comments yet"
                    message="Comment on a video and it will show up here."
                    action={
                        <Link
                            to="/"
                            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-white"
                        >
                            Browse videos
                        </Link>
                    }
                />
            ) : (
                <VideoGrid
                    videos={videos}
                    isLoading={isLoading}
                    error={error}
                    onRetry={refetch}
                    emptyTitle="No comments yet"
                    emptyMessage="Comment on a video and it will show up here."
                />
            )}
        </div>
    );
}
