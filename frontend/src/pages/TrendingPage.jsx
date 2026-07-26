import { Flame } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { VideoGrid } from "@/features/video/VideoGrid";
import { useTrendingVideos } from "@/features/video/hooks";

export default function TrendingPage() {
    const { data, isLoading, error, refetch } = useTrendingVideos({ limit: 24 });
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Flame}
                title="Trending"
                subtitle="What the AnimeVerse is watching right now."
            />
            <VideoGrid
                videos={data}
                isLoading={isLoading}
                error={error}
                onRetry={refetch}
                skeletonCount={12}
                emptyTitle="Nothing trending right now"
                emptyMessage="Check back in a bit  -  the world is quiet."
            />
        </div>
    );
}
