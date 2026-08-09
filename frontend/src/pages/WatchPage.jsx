import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ChevronLeft, Flame } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { VideoPlayer, VideoPlayerSkeleton } from "@/features/video/VideoPlayer";
import { VideoInfoActions } from "@/features/video/VideoInfoActions";
import { VideoDescription } from "@/features/video/VideoDescription";
import { CreatorCard } from "@/features/video/CreatorCard";
import { SuggestedVideoRow, SuggestedVideoSkeleton } from "@/features/video/SuggestedVideoRow";
import { CommentsSection } from "@/features/comment/CommentsSection";
import { useTrendingVideos, useVideo } from "@/features/video/hooks";
import { PATHS } from "@/routes/paths";

export default function WatchPage() {
    const { videoId } = useParams();
    const { data: video, isLoading, error, refetch } = useVideo(videoId);
    const suggested = useTrendingVideos({ limit: 10 });

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [videoId]);

    const relatedVideos = (suggested.data || []).filter((v) => v._id !== videoId);

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
        >
            <div className="min-w-0 space-y-4">
                {error ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20 text-rose-300">
                            <AlertCircle className="h-5 w-5" />
                        </div>
                        <h2 className="font-display text-xl font-semibold text-white">
                            This video couldn't load
                        </h2>
                        <p className="text-sm text-muted">
                            {error?.response?.status === 404
                                ? "It may have been removed or made private."
                                : "Try again in a moment."}
                        </p>
                        <div className="flex gap-2">
                            <Link to={PATHS.home}>
                                <Button variant="ghost">
                                    <ChevronLeft className="h-4 w-4" /> Back home
                                </Button>
                            </Link>
                            <Button variant="primary" onClick={() => refetch()}>Try again</Button>
                        </div>
                    </div>
                ) : isLoading || !video ? (
                    <>
                        <VideoPlayerSkeleton />
                        <div className="space-y-2">
                            <Skeleton className="h-6 w-3/4 rounded-md" />
                            <Skeleton className="h-4 w-1/2 rounded-md" />
                        </div>
                        <Skeleton className="h-24 w-full rounded-2xl" />
                    </>
                ) : (
                    <>
                        {/*
                          * The player picks its own implementation from sourceType.
                          * Everything below this line — title, creator, likes,
                          * comments, subscriptions, watch history, suggestions — is
                          * source-agnostic and needed no changes.
                          */}
                        <VideoPlayer
                            sourceType={video.sourceType}
                            externalVideoId={video.externalVideoId}
                            src={video.videoFile || video.videoUrl}
                            poster={video.thumbnail}
                            title={video.title}
                        />
                        <h1 className="font-display text-xl font-semibold leading-snug text-white sm:text-2xl">
                            {video.title}
                        </h1>

                        <CreatorCard owner={video.owner} videoId={video._id} />
                        <VideoInfoActions video={video} />
                        <VideoDescription video={video} />
                    </>
                )}

                {/* Comments */}
                {video?._id && !error && (
                    <div className="pt-4">
                        <CommentsSection videoId={video._id} pinnedCommentId={video.pinnedCommentId} />
                    </div>
                )}
            </div>

            {/* Sidebar */}
            <aside className="min-w-0 space-y-4">
                <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-accent" />
                    <h3 className="font-display text-sm font-semibold uppercase tracking-widest text-white">
                        Up Next
                    </h3>
                </div>
                <div className="space-y-4">
                    {suggested.isLoading
                        ? Array.from({ length: 6 }).map((_, i) => <SuggestedVideoSkeleton key={i} />)
                        : relatedVideos.slice(0, 10).map((v) => (
                              <SuggestedVideoRow key={v._id} video={v} />
                          ))}
                    {!suggested.isLoading && relatedVideos.length === 0 && (
                        <p className="text-sm text-muted">No suggestions yet — try another category.</p>
                    )}
                </div>
            </aside>
        </motion.div>
    );
}
