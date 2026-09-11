import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MessagesSquare, Heart, ArrowRight, Newspaper, BarChart3, Image as ImageIcon } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PATHS } from "@/routes/paths";
import { timeAgo } from "@/utils/format";

const typeIcon = {
    discussion: MessagesSquare,
    news: Newspaper,
    poll: BarChart3,
    meme: ImageIcon,
};

function PostCard({ post, onUpvote, canUpvote = false, onVote, canVote = false }) {
    const author = post.author || post.owner || {};
    const TypeIcon = typeIcon[post.type] || MessagesSquare;
    const upvotes = post.upvoteCount ?? post.upvotes ?? post.likesCount ?? post.likes ?? 0;

    return (
        <motion.article
            whileHover={{ y: -2 }}
            className="flex h-full flex-col justify-between rounded-2xl border border-white/5 bg-card/60 p-4 backdrop-blur"
        >
            <div>
                <div className="flex items-center gap-3">
                    <Avatar size="sm" src={author.avatar} name={author.fullName || author.username} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                            {author.fullName || author.username || "AnimeVerse member"}
                        </div>
                        <div className="text-[11px] text-muted">{timeAgo(post.createdAt)}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-wider text-muted">
                        <TypeIcon className="h-3 w-3" /> {post.type || "discussion"}
                    </span>
                </div>

                {post.title && (
                    <h3 className="mt-3 line-clamp-2 font-display text-base font-semibold text-white">
                        {post.title}
                    </h3>
                )}
                <p className="mt-2 line-clamp-4 text-sm text-white/80">
                    {post.content || post.text || "Join the conversation."}
                </p>

                {post.imageUrl && (
                    <img
                        src={post.imageUrl}
                        alt={post.title || "Community post"}
                        loading="lazy"
                        className="mt-3 aspect-video w-full rounded-xl border border-white/5 object-cover"
                    />
                )}

                {post.type === "poll" && Array.isArray(post.pollOptions) && post.pollOptions.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                        {post.pollOptions.slice(0, 4).map((option, index) => {
                            const content = (
                                <>
                                    <span>{option.text}</span>
                                    {Number.isFinite(option.votes) && (
                                        <span className="ml-auto text-[10px] text-muted">{option.votes} vote{option.votes === 1 ? "" : "s"}</span>
                                    )}
                                </>
                            );
                            return onVote ? (
                                <button
                                    key={`${post._id}-poll-${index}`}
                                    type="button"
                                    disabled={!canVote}
                                    onClick={() => onVote(post, index)}
                                    className="flex w-full items-center rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-left text-xs text-white/70 transition hover:border-accent/30 hover:bg-accent/10 disabled:cursor-default disabled:hover:border-white/5 disabled:hover:bg-white/[0.03]"
                                >
                                    {content}
                                </button>
                            ) : (
                                <div key={`${post._id}-poll-${index}`} className="flex items-center rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/70">
                                    {content}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
                <button
                    type="button"
                    disabled={!canUpvote || !onUpvote}
                    onClick={() => onUpvote?.(post)}
                    className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-white/5 hover:text-rose-300 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted"
                    title={canUpvote ? "Upvote" : "Sign in to upvote"}
                >
                    <Heart className="h-3.5 w-3.5" /> {upvotes}
                </button>
                {post.type === "poll" ? (
                    <span className="inline-flex items-center gap-1">
                        <BarChart3 className="h-3.5 w-3.5" /> Poll
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1">
                        <MessagesSquare className="h-3.5 w-3.5" /> Discussion
                    </span>
                )}
            </div>
        </motion.article>
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

export function CommunityPreview({ posts, isLoading, error, onUpvote, canUpvote = false, onVote, canVote = false, limit = 3, showHeader = true }) {
    if (error) return null;

    return (
        <div>
            {showHeader && (
                <div className="mb-4 flex items-end justify-between">
                    <div>
                        <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">
                            From the community
                        </h2>
                        <p className="mt-1 text-xs text-muted sm:text-sm">
                            Fresh discussions, polls, news, and fan takes from AnimeVerse members.
                        </p>
                    </div>
                    <Link
                        to={PATHS.community}
                        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-white"
                    >
                        Explore community <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            )}

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
                    message="Start a discussion from the Community page and it will appear here."
                />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {posts.slice(0, limit).map((post) => (
                        <PostCard
                            key={post._id || post.id}
                            post={post}
                            onUpvote={onUpvote}
                            canUpvote={canUpvote}
                            onVote={onVote}
                            canVote={canVote}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
