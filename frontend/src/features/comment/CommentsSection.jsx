import { useEffect, useMemo, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";
import { useAddComment, useComments } from "./hooks";

function CommentSkeleton() {
    return (
        <div className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-[90%]" />
                <Skeleton className="h-3 w-[60%]" />
            </div>
        </div>
    );
}

export function CommentsSection({ videoId, pinnedCommentId }) {
    const { user } = useAuth();
    const toast = useToast();
    const {
        data,
        error,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
    } = useComments(videoId);
    const add = useAddComment(videoId);

    const sentinelRef = useRef(null);
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            },
            { rootMargin: "300px" }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const { pinned, rest, total } = useMemo(() => {
        const items = (data?.pages || []).flatMap((p) => p.items);
        const first = data?.pages?.[0];
        const total = first?.totalDocs ?? items.length;
        let pinned = null;
        let rest = items;
        if (pinnedCommentId) {
            pinned = items.find((c) => c._id === pinnedCommentId) || null;
            rest = items.filter((c) => c._id !== pinnedCommentId);
        }
        return { pinned, rest, total };
    }, [data, pinnedCommentId]);

    const onPost = async (content) => {
        if (!user) return toast.info("Sign in to comment");
        try {
            await add.mutateAsync({ content });
            toast.success("Comment posted");
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't post comment"));
        }
    };

    if (error) {
        return (
            <ErrorState
                title="Comments unavailable"
                message="We couldn't load the discussion."
                onRetry={refetch}
            />
        );
    }

    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-accent" />
                <h3 className="font-display text-lg font-semibold text-white">
                    {isLoading ? "Comments" : `${total.toLocaleString()} Comments`}
                </h3>
            </div>

            <CommentComposer
                onSubmit={onPost}
                submitting={add.isPending}
                placeholder={user ? "Share your thoughts…" : "Sign in to add a comment"}
            />

            {isLoading ? (
                <div className="space-y-6 pt-2">
                    <CommentSkeleton />
                    <CommentSkeleton />
                    <CommentSkeleton />
                </div>
            ) : total === 0 ? (
                <EmptyState
                    icon={MessageSquare}
                    title="Be the first to comment"
                    message="Kick off the discussion. Predictions, hot takes, and lore are welcome."
                />
            ) : (
                <div className="space-y-6">
                    <AnimatePresence initial={false}>
                        {pinned && (
                            <CommentItem
                                key={pinned._id}
                                comment={pinned}
                                videoId={videoId}
                                pinnedId={pinnedCommentId}
                            />
                        )}
                        {rest.map((c) => (
                            <CommentItem key={c._id} comment={c} videoId={videoId} />
                        ))}
                    </AnimatePresence>

                    <div ref={sentinelRef} className="h-6 w-full" aria-hidden />
                    {isFetchingNextPage && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                            <CommentSkeleton />
                            <CommentSkeleton />
                        </motion.div>
                    )}
                </div>
            )}
        </section>
    );
}