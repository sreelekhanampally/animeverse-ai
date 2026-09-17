import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ChevronLeft, Flame, Network, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { VideoPlayer, VideoPlayerSkeleton } from "@/features/video/VideoPlayer";
import { VideoInfoActions } from "@/features/video/VideoInfoActions";
import { VideoDescription } from "@/features/video/VideoDescription";
import { CreatorCard } from "@/features/video/CreatorCard";
import { SuggestedVideoRow, SuggestedVideoSkeleton } from "@/features/video/SuggestedVideoRow";
import { CommentsSection } from "@/features/comment/CommentsSection";
import { useDiscoveryGraph, useSimilarVideos, useTrendingVideos, useVideo } from "@/features/video/hooks";
import { SemanticGraph } from "@/features/discovery/SemanticGraph";
import { PATHS } from "@/routes/paths";

export default function WatchPage() {
    const { videoId } = useParams();
    const [graphOpen, setGraphOpen] = useState(false);
    const { data: video, isLoading, error, refetch } = useVideo(videoId);
    const similar = useSimilarVideos(videoId, { limit: 10 });
    const graph = useDiscoveryGraph(videoId, { limit: 10, enabled: graphOpen });
    const suggested = useTrendingVideos({ limit: 10 });

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [videoId]);

    const similarResults = similar.data?.results || [];
    const fallbackVideos = (suggested.data || []).filter((v) => v._id !== videoId);
    const relatedVideos = similarResults.length ? similarResults.map((item) => item.video) : fallbackVideos;

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
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                        {similarResults.length ? (
                            <Sparkles className="h-4 w-4 text-accent" />
                        ) : (
                            <Flame className="h-4 w-4 text-accent" />
                        )}
                        <div>
                            <h3 className="font-display text-sm font-semibold uppercase tracking-widest text-white">
                                {similarResults.length ? "More like this" : "Up Next"}
                            </h3>
                            {similarResults.length > 0 && (
                                <p className="mt-1 text-[10px] text-muted">Semantic neighbors from AnimeVerse embeddings</p>
                            )}
                        </div>
                    </div>
                    {similarResults.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setGraphOpen(true)}
                            className="inline-flex items-center gap-1 rounded-lg border border-accent/20 bg-accent/[0.06] px-2 py-1 text-[10px] font-medium text-accent transition hover:border-accent/50 hover:text-white"
                        >
                            <Network className="h-3 w-3" /> Map
                        </button>
                    )}
                </div>
                <div className="space-y-4">
                    {similar.isLoading || (!similarResults.length && suggested.isLoading)
                        ? Array.from({ length: 6 }).map((_, i) => <SuggestedVideoSkeleton key={i} />)
                        : similarResults.length
                          ? similarResults.slice(0, 10).map((item) => (
                                <div key={item.video?._id} className="space-y-1.5">
                                    <SuggestedVideoRow video={item.video} />
                                    <div className="flex flex-wrap gap-1 pl-1">
                                        {(item.reasons || []).slice(0, 2).map((reason) => (
                                            <span
                                                key={reason}
                                                className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] text-muted"
                                            >
                                                {reason}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))
                          : relatedVideos.slice(0, 10).map((v) => <SuggestedVideoRow key={v._id} video={v} />)}
                    {!similar.isLoading && !suggested.isLoading && relatedVideos.length === 0 && (
                        <p className="text-sm text-muted">No suggestions yet — try another category.</p>
                    )}
                </div>
            </aside>

            <Modal
                open={graphOpen}
                onClose={() => setGraphOpen(false)}
                title="Semantic similarity map"
                description="Explore videos near this one in AnimeVerse's local embedding space."
                size="xl"
            >
                {graph.isLoading ? (
                    <div className="flex h-[420px] items-center justify-center text-sm text-muted">Building map…</div>
                ) : graph.error ? (
                    <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-100">
                        Could not build the semantic map right now.
                    </div>
                ) : (
                    <SemanticGraph graph={graph.data} />
                )}
            </Modal>
        </motion.div>
    );
}
