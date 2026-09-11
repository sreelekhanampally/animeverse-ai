import { Clock } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { VideoGrid } from "@/features/video/VideoGrid";
import { useWatchLater } from "@/features/video/hooks";

export default function WatchLaterPage() {
    const { data, isLoading, error, refetch } = useWatchLater();
    const videos = data || [];

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Clock}
                title="Watch later"
                subtitle={
                    isLoading || videos.length === 0
                        ? "Your saved queue for when you're free."
                        : `${videos.length.toLocaleString()} saved video${videos.length === 1 ? "" : "s"}, newest save first.`
                }
            />
            <VideoGrid
                videos={videos}
                isLoading={isLoading}
                error={error}
                onRetry={refetch}
                emptyTitle="Queue is empty"
                emptyMessage="Open a video and choose Watch Later to save it here."
            />
        </div>
    );
}
