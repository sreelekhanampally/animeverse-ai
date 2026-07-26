import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MessagesSquare, Heart, ArrowRight } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PATHS } from "@/routes/paths";
import { timeAgo } from "@/utils/format";

function PostCard({ post }) {
    const author = post.owner || post.author || {};
    return (
        <motion.div
            whileHover={{ y: -2 }}
            className="flex h-full flex-col justify-between rounded-2xl border border-white/5 bg-card/60 p-4 backdrop-blur"
        >
            <div>
                <div className="flex items-center gap-3">
                    <Avatar size="sm" src={author.avatar} name={author.fullName || author.username} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                            {author.fullName || author.username || "Anonymous"}
                        </div>
                        <div className="text-[11px] text-muted">
                            {timeAgo(post.createdAt)}
                        </div>
                    </div>
                </div>
                <p className="mt-3 line-clamp-4 text-sm text-white/85">{post.content || post.text}</p>
            </div>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                    <Heart className="h-3.5 w-3.5" /> {post.likesCount ?? post.likes ?? 0}
                </span>
                <span className="inline-flex items-center gap-1">
                    <MessagesSquare className="h-3.5 w-3.5" /> {post.commentsCount ?? 0}
                </span>
            </div>
        </motion.div>
    );
}

function PostSkeleton() {
    return (
        <div className="rounded-2xl border border-white/5 bg-card/60 p-4">
            <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-20" />
                </div>
            </div>
            <div className="mt-4 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-[85%]" />
                <Skeleton className="h-3 w-[60%]" />
            </div>
        </div>
    );
}

export function CommunityPreview({ posts, isLoading, error }) {
    if (error) {
        return null;
    }
    return (
        <div>
            <div className="mb-4 flex items-end justify-between">
                <div>
                    <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">
                        From the community
                    </h2>
                    <p className="mt-1 text-xs text-muted sm:text-sm">
                        Fresh takes, hot debates, and creator posts.
                    </p>
                </div>
                <Link
                    to={PATHS.community}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-white"
                >
                    Explore community <ArrowRight className="h-4 w-4" />
                </Link>
            </div>

            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <PostSkeleton />
                    <PostSkeleton />
                    <PostSkeleton />
                </div>
            ) : !posts || posts.length === 0 ? (
                <EmptyState
                    icon={MessagesSquare}
                    title="Community is quiet"
                    message="Once tweets and discussions land, the highlight reel appears here."
                />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {posts.slice(0, 3).map((p) => (
                        <PostCard key={p._id || p.id} post={p} />
                    ))}
                </div>
            )}
        </div>
    );
}
