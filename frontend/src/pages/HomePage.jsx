import { useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Sparkles, Heart, PlayCircle, Rocket, Palette, UploadCloud } from "lucide-react";
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
                            ? "Choose a genre to reshape this row using the genres stored with each anime."
                            : `Videos linked to anime tagged ${genre} in the catalogue.`
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
                    subtitle="Ranked by the platform's real view counts, highest first."
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
                    title={user ? "Recommended for you" : "Recommended starting points"}
                    subtitle={
                        user
                            ? "Uses your recent watch history when compatible embeddings are available, then ranks nearby videos."
                            : "A view-and-recency mix for visitors who do not have watch history yet."
                    }
                    action={
                        <Link
                            to={PATHS.aiSearch}
                            className="text-xs font-medium text-accent hover:text-white"
                        >
                            Try AI Search
                        </Link>
                    }
                />
                <VideoRow
                    videos={recommended.data}
                    isLoading={recommended.isLoading}
                    error={recommended.error}
                    onRetry={() => recommended.refetch()}
                    skeletonCount={6}
                />
            </section>

            {user && (
                <section>
                    <SectionHeader
                        icon={PlayCircle}
                        title="Recently watched"
                        subtitle="Your history is kept newest-first so you can jump back into something you opened recently."
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
                        title="Because you liked these creators"
                        subtitle="More videos from a creator behind something you liked."
                        to={PATHS.liked}
                    />
                    <VideoRow
                        videos={basedOnLikes.data}
                        isLoading={basedOnLikes.isLoading}
                        error={basedOnLikes.error}
                        onRetry={() => basedOnLikes.refetch()}
                        emptyIcon={Heart}
                        emptyTitle="Like some videos"
                        emptyMessage="Like content and this row will learn which creators to revisit."
                    />
                </section>
            )}

            <section>
                <SectionHeader
                    icon={UploadCloud}
                    title="Creator originals"
                    subtitle="Videos uploaded directly by AnimeVerse creators and played from Cloudinary."
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
                    emptyMessage="Creator uploads will appear here separately from YouTube embeds."
                />
            </section>

            <section>
                <SectionHeader
                    icon={Rocket}
                    title="New on AnimeVerse"
                    subtitle="The newest published additions across creator uploads and imported anime videos."
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
