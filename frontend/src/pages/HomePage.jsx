import { Flame, Sparkles, Clock, Heart, PlayCircle, Rocket } from "lucide-react";
import { HeroBanner } from "@/features/home/HeroBanner";
import { CategoryChips } from "@/features/home/CategoryChips";
import { SectionHeader } from "@/features/home/SectionHeader";
import { VideoRow } from "@/features/video/VideoRow";
import { ContinueWatchingCard } from "@/features/video/ContinueWatchingCard";
import {
    useLatestVideos,
    useRecommendedVideos,
    useTrendingVideos,
    useContinueWatching,
    useBasedOnLikes,
    useRecentUploads,
} from "@/features/video/hooks";
import { CommunityPreview } from "@/features/community/CommunityPreview";
import { useCommunityFeed } from "@/features/community/hooks";
import { useAuth } from "@/contexts/AuthContext";
import { PATHS } from "@/routes/paths";

export default function HomePage() {
    const { user } = useAuth();

    const trending = useTrendingVideos({ limit: 12 });
    const recommended = useRecommendedVideos({ limit: 12 });
    const latest = useLatestVideos({ limit: 12 });
    const recent = useRecentUploads({ limit: 12 });
    const community = useCommunityFeed({ limit: 6 });

    const continueWatching = useContinueWatching();
    const basedOnLikes = useBasedOnLikes({ limit: 12 });

    return (
        <div className="space-y-10">
            <HeroBanner />

            <CategoryChips />

            {/* Trending */}
            <section>
                <SectionHeader
                    icon={Flame}
                    title="🔥 Trending Anime"
                    subtitle="Everyone's watching these across AnimeVerse."
                    to={PATHS.trending}
                />
                <VideoRow
                    videos={trending.data}
                    isLoading={trending.isLoading}
                    error={trending.error}
                    onRetry={() => trending.refetch()}
                    skeletonCount={6}
                    emptyIcon={Flame}
                    emptyTitle="Nothing trending yet"
                />
            </section>

            {/* Recommended */}
            <section>
                <SectionHeader
                    icon={Sparkles}
                    title="⭐ Recommended For You"
                    subtitle="Handpicked based on what's popular."
                />
                <VideoRow
                    videos={recommended.data}
                    isLoading={recommended.isLoading}
                    error={recommended.error}
                    onRetry={() => recommended.refetch()}
                    skeletonCount={6}
                />
            </section>

            {/* Latest Uploads */}
            <section>
                <SectionHeader
                    icon={Rocket}
                    title="🆕 Latest Uploads"
                    subtitle="Fresh episodes, edits, and creator drops."
                />
                <VideoRow
                    videos={latest.data}
                    isLoading={latest.isLoading}
                    error={latest.error}
                    onRetry={() => latest.refetch()}
                />
            </section>

            {/* Continue Watching (only if authed and has history) */}
            {user && (
                <section>
                    <SectionHeader
                        icon={PlayCircle}
                        title="📺 Continue Watching"
                        subtitle="Pick up right where you left off."
                        to={PATHS.history}
                    />
                    <VideoRow
                        videos={continueWatching.data}
                        isLoading={continueWatching.isLoading}
                        error={continueWatching.error}
                        onRetry={() => continueWatching.refetch()}
                        emptyIcon={PlayCircle}
                        emptyTitle="Nothing to resume"
                        emptyMessage="Once you start watching, we'll save your spot here."
                        renderCard={(v) => <ContinueWatchingCard video={v} />}
                    />
                </section>
            )}

            {/* Based on Likes (auth only) */}
            {user && (
                <section>
                    <SectionHeader
                        icon={Heart}
                        title="❤️ Based on Your Likes"
                        subtitle="More from creators you've enjoyed."
                        to={PATHS.liked}
                    />
                    <VideoRow
                        videos={basedOnLikes.data}
                        isLoading={basedOnLikes.isLoading}
                        error={basedOnLikes.error}
                        onRetry={() => basedOnLikes.refetch()}
                        emptyIcon={Heart}
                        emptyTitle="Like some videos"
                        emptyMessage="Like content and this row will fill up with related picks."
                    />
                </section>
            )}

            {/* Recently uploaded */}
            <section>
                <SectionHeader
                    icon={Clock}
                    title="🎬 Recently Uploaded"
                    subtitle="The most recent additions to the platform."
                />
                <VideoRow
                    videos={recent.data}
                    isLoading={recent.isLoading}
                    error={recent.error}
                    onRetry={() => recent.refetch()}
                />
            </section>

            {/* Community */}
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