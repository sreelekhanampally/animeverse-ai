import { useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Sparkles, Heart, PlayCircle, Rocket, Palette, UploadCloud } from "lucide-react";
import { HeroBanner } from "@/features/home/HeroBanner";
import { CategoryChips } from "@/features/home/CategoryChips";
import { SectionHeader } from "@/features/home/SectionHeader";
import { VideoRow } from "@/features/video/VideoRow";
import { ContinueWatchingCard } from "@/features/video/ContinueWatchingCard";
import { ExplainableVideoCard } from "@/features/discovery/ExplainableVideoCard";
import {
    useLatestVideos,
    useRecommendedVideos,
    useTrendingVideos,
    useContinueWatching,
    useBasedOnLikes,
    useGenreVideos,
    useCreatorOriginals,
} from "@/features/video/hooks";
import { CommunityPreview } from "@/features/community/CommunityPreview";
import { useCommunityFeed } from "@/features/community/hooks";
import { useAuth } from "@/contexts/AuthContext";
import { PATHS } from "@/routes/paths";

export default function HomePage() {
    const { user } = useAuth();
    const [genre, setGenre] = useState("All");

    const trending = useTrendingVideos({ limit: 12 });
    const recommended = useRecommendedVideos({ limit: 12 });
    const latest = useLatestVideos({ limit: 12 });
    const genreVideos = useGenreVideos(genre, { limit: 12 });
    const creatorOriginals = useCreatorOriginals({ limit: 12 });
    const community = useCommunityFeed({ limit: 6 });
    const continueWatching = useContinueWatching();
    const basedOnLikes = useBasedOnLikes({ limit: 12 });

    return (
        <div className="space-y-10">
            <HeroBanner />

            <section>
                <SectionHeader
                    icon={Palette}
                    title={genre === "All" ? "Browse the catalogue" : `${genre} picks`}
                    subtitle={
                        genre === "All"
                            ? "Pick a genre to update this row."
                            : `${genre} videos from the catalogue.`
                    }
                />
                <CategoryChips value={genre} onChange={setGenre} />
                <div className="mt-4">
                    <VideoRow
                        videos={genreVideos.data}
                        isLoading={genreVideos.isLoading}
                        error={genreVideos.error}
                        onRetry={() => genreVideos.refetch()}
                        emptyIcon={Palette}
                        emptyTitle={`No ${genre === "All" ? "catalogue" : genre} videos yet`}
                        emptyMessage="As the catalogue grows, matching videos will appear here."
                    />
                </div>
            </section>

            <section>
                <SectionHeader
                    icon={Flame}
                    title="Most watched on AnimeVerse"
                    subtitle="The videos getting the most views right now."
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

            <section>
                <SectionHeader
                    icon={Sparkles}
                    title={user ? "Recommended for you" : "Popular picks"}
                    subtitle={
                        user
                            ? "Based on what you've watched, liked, and saved."
                            : "Popular and recent videos to get you started."
                    }
                    action={
                        <Link
                            to={PATHS.aiSearch}
                            className="text-xs font-medium text-accent hover:text-white"
                        >
                            Search by description
                        </Link>
                    }
                />
                <VideoRow
                    videos={recommended.data}
                    isLoading={recommended.isLoading}
                    error={recommended.error}
                    onRetry={() => recommended.refetch()}
                    skeletonCount={6}
                    renderCard={(video) => (
                        <ExplainableVideoCard
                            video={video}
                            reasons={video.recommendation?.reasons || []}
                            score={video.recommendation?.score}
                            label="Why recommended"
                        />
                    )}
                />
            </section>

            {user && (
                <section>
                    <SectionHeader
                        icon={PlayCircle}
                        title="Recently watched"
                        subtitle="Videos you opened recently."
                        to={PATHS.history}
                    />
                    <VideoRow
                        videos={continueWatching.data}
                        isLoading={continueWatching.isLoading}
                        error={continueWatching.error}
                        onRetry={() => continueWatching.refetch()}
                        emptyIcon={PlayCircle}
                        emptyTitle="Nothing watched yet"
                        emptyMessage="Open a video and it will appear here."
                        renderCard={(video) => <ContinueWatchingCard video={video} />}
                    />
                </section>
            )}

            {user && (
                <section>
                    <SectionHeader
                        icon={Heart}
                        title="More from creators you liked"
                        subtitle="More from creators you've liked before."
                        to={PATHS.liked}
                    />
                    <VideoRow
                        videos={basedOnLikes.data}
                        isLoading={basedOnLikes.isLoading}
                        error={basedOnLikes.error}
                        onRetry={() => basedOnLikes.refetch()}
                        emptyIcon={Heart}
                        emptyTitle="Like some videos"
                        emptyMessage="Like a few videos and more from those creators will show up here."
                    />
                </section>
            )}

            <section>
                <SectionHeader
                    icon={UploadCloud}
                    title="Creator originals"
                    subtitle="Uploaded directly by AnimeVerse creators."
                    action={
                        user ? (
                            <Link
                                to={PATHS.upload}
                                className="text-xs font-medium text-accent hover:text-white"
                            >
                                Upload yours
                            </Link>
                        ) : undefined
                    }
                />
                <VideoRow
                    videos={creatorOriginals.data}
                    isLoading={creatorOriginals.isLoading}
                    error={creatorOriginals.error}
                    onRetry={() => creatorOriginals.refetch()}
                    emptyIcon={UploadCloud}
                    emptyTitle="No creator uploads yet"
                    emptyMessage="Creator uploads will appear here."
                />
            </section>

            <section>
                <SectionHeader
                    icon={Rocket}
                    title="New on AnimeVerse"
                    subtitle="Recently added videos."
                />
                <VideoRow
                    videos={latest.data}
                    isLoading={latest.isLoading}
                    error={latest.error}
                    onRetry={() => latest.refetch()}
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
