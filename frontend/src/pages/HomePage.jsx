import { Flame, Sparkles, Clock } from "lucide-react";
import { HeroBanner } from "@/features/home/HeroBanner";
import { CategoryChips } from "@/features/home/CategoryChips";
import { SectionHeader } from "@/features/home/SectionHeader";
import { VideoGrid } from "@/features/video/VideoGrid";
import {
    useLatestVideos,
    useRecommendedVideos,
    useTrendingVideos,
} from "@/features/video/hooks";
import { CommunityPreview } from "@/features/community/CommunityPreview";
import { useCommunityFeed } from "@/features/community/hooks";
import { PATHS } from "@/routes/paths";

export default function HomePage() {
    const recommended = useRecommendedVideos({ limit: 8 });
    const trending = useTrendingVideos({ limit: 8 });
    const latest = useLatestVideos({ limit: 12 });
    const community = useCommunityFeed({ limit: 6 });

    return (
        <div className="space-y-10">
            <HeroBanner />

            <CategoryChips />

            <section>
                <SectionHeader
                    icon={Sparkles}
                    title="Recommended for you"
                    subtitle="Curated based on new arrivals and popular picks."
                    to={PATHS.aiSearch}
                />
                <VideoGrid
                    videos={recommended.data}
                    isLoading={recommended.isLoading}
                    error={recommended.error}
                    onRetry={() => recommended.refetch()}
                    skeletonCount={8}
                    emptyTitle="Nothing to recommend yet"
                    emptyMessage="Watch a few videos to unlock personalized picks."
                />
            </section>

            <section>
                <SectionHeader
                    icon={Flame}
                    title="Trending now"
                    subtitle="Everyone's watching these across AnimeVerse."
                    to={PATHS.trending}
                />
                <VideoGrid
                    videos={trending.data}
                    isLoading={trending.isLoading}
                    error={trending.error}
                    onRetry={() => trending.refetch()}
                    skeletonCount={8}
                    emptyTitle="No trends today"
                    emptyMessage="Check back soon  -  the algorithm is warming up."
                />
            </section>

            <section>
                <SectionHeader
                    icon={Clock}
                    title="Latest uploads"
                    subtitle="Fresh episodes, edits, and creator drops."
                />
                <VideoGrid
                    videos={latest.data}
                    isLoading={latest.isLoading}
                    error={latest.error}
                    onRetry={() => latest.refetch()}
                    skeletonCount={8}
                    emptyTitle="No new uploads yet"
                    emptyMessage="Once creators upload, their latest videos land here."
                />
            </section>

            <section>
                <CommunityPreview
                    posts={community.data}
                    isLoading={community.isLoading}
                    error={community.error}
                />
            </section>
        </div>
    );
}
