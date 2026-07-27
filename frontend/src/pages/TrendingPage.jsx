import { Flame } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { InfiniteVideoGrid } from "@/features/video/InfiniteVideoGrid";
import { useInfiniteVideos } from "@/features/video/hooks";

export default function TrendingPage() {
    const query = useInfiniteVideos({ sortBy: "views", sortType: "desc" });
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Flame}
                title="Trending"
                subtitle="What the AnimeVerse is watching right now."
            />
            <InfiniteVideoGrid
                query={query}
                emptyTitle="Nothing trending right now"
                emptyMessage="Check back in a bit — the world is quiet."
            />
        </div>
    );
}