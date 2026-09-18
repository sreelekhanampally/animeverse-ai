import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
    MessagesSquare,
    Heart,
    ArrowRight,
    Newspaper,
    BarChart3,
    Image as ImageIcon,
    Check,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PATHS, channelPath, communityPostPath } from "@/routes/paths";
import { timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

const typeIcon = {
    discussion: MessagesSquare,
    news: Newspaper,
    poll: BarChart3,
    meme: ImageIcon,
};

const typeLabel = {
    discussion: "Discussion",
    news: "News",
    poll: "Poll",
    meme: "Meme",
};

function PostCard({ post, onUpvote, canUpvote = false, onVote, canVote = false }) {
    const author = post.author || post.owner || {};
    const TypeIcon = typeIcon[post.type] || MessagesSquare;
    const upvotes = post.upvoteCount ?? post.upvotes ?? post.likesCount ?? post.likes ?? 0;
    const commentCount = Number(post.commentCount || 0);
    const detailPath = communityPostPath(post._id || post.id);
    const selectedPollOption = Number.isInteger(post.selectedPollOption)
        ? post.selectedPollOption
        : null;

    return (
        <motion.article
            whileHover={{ y: -2 }}
            className="flex h-full flex-col justify-between rounded-2xl border border-white/5 bg-card/60 p-4 backdrop-blur"
        >
            <div>
                <div className="flex items-center gap-3">
                    {author.username ? (
                        <Link to={channelPath(author.username)} className="shrink-0">
                            <Avatar size="sm" src={author.avatar} name={author.fullName || author.username} />
                        </Link>
                    ) : (
                        <Avatar size="sm" src={author.avatar} name={author.fullName || author.username} />
                    )}
                    <div className="min-w-0 flex-1">
                        {author.username ? (
                            <Link
                                to={channelPath(author.username)}
                                className="block truncate text-sm font-medium text-white hover:text-accent"
                            >
                                {author.fullName || author.username}
                            </Link>
                        ) : (
                            <div className="truncate text-sm font-medium text-white">AnimeVerse member</div>
                        )}
                        <div className="text-[11px] text-muted">{timeAgo(post.createdAt)}</div>
                    </div>
                    <Link
                        to={`${PATHS.community}?type=${post.type || "discussion"}`}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-wider text-muted transition hover:border-accent/30 hover:text-white"
                    >
                        <TypeIcon className="h-3 w-3" /> {typeLabel[post.type] || "Discussion"}
                    </Link>
                </div>

                <Link to={detailPath} className="block">
                    {post.title && (
                        <h3 className="mt-3 line-clamp-2 font-display text-base font-semibold text-white transition hover:text-accent">
                            {post.title}
                        </h3>
                    )}
                    <p className="mt-2 line-clamp-4 text-sm text-white/80">
                        {post.content || post.text || "Open the post to join the conversation."}
                    </p>
                </Link>

                {post.imageUrl && (
                    <Link to={detailPath} className="block">
                        <img
                            src={post.imageUrl}
                            alt={post.title || "Community post"}
                            loading="lazy"
                            className="mt-3 aspect-video w-full rounded-xl border border-white/5 object-cover"
                        />
                    </Link>
                )}

                {post.type === "poll" && Array.isArray(post.pollOptions) && post.pollOptions.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                        {post.pollOptions.slice(0, 6).map((option, index) => {
                            const selected = selectedPollOption === index;
                            const content = (
                                <>
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                                        <span className="truncate">{option.text}</span>
                                    </span>
                                    {Number.isFinite(option.votes) && (
                                        <span className="shrink-0 text-[10px] text-muted">
                                            {option.votes} vote{option.votes === 1 ? "" : "s"}
                                        </span>
                                    )}
                                </>
                            );

                            const optionClass = cn(
                                "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition",
                                selected
                                    ? "border-accent/50 bg-accent/15 text-white"
                                    : "border-white/5 bg-white/[0.03] text-white/70 hover:border-accent/30 hover:bg-accent/10"
                            );

                            return onVote ? (
                                <button
                                    key={`${post._id}-poll-${index}`}
                                    type="button"
                                    onClick={() => onVote(post, index)}
                                    aria-pressed={selected}
                                    className={optionClass}
                                >
                                    {content}
                                </button>
                            ) : (
                                <Link
                                    key={`${post._id}-poll-${index}`}
                                    to={detailPath}
                                    className={optionClass}
                                >
                                    {content}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center gap-3 text-xs text-muted">
                {onUpvote ? (
                    <button
                        type="button"
                        onClick={() => onUpvote(post)}
                        aria-pressed={!!post.hasUpvoted}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition",
                            post.hasUpvoted
                                ? "text-rose-300"
                                : "hover:bg-white/5 hover:text-rose-300"
                        )}
                        title={canUpvote ? (post.hasUpvoted ? "Remove upvote" : "Upvote") : "Sign in to upvote"}
                    >
                        <Heart className={cn("h-3.5 w-3.5", post.hasUpvoted && "fill-current")} /> {upvotes}
                    </button>
                ) : (
                    <Link
                        to={detailPath}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-white/5",
                            post.hasUpvoted ? "text-rose-300" : "hover:text-rose-300"
                        )}
                    >
                        <Heart className={cn("h-3.5 w-3.5", post.hasUpvoted && "fill-current")} /> {upvotes}
                    </Link>
                )}

                <Link
                    to={detailPath}
                    className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-white/5 hover:text-white"
                >
                    <MessagesSquare className="h-3.5 w-3.5" />
                    {commentCount} {commentCount === 1 ? "reply" : "replies"}
                </Link>
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

export function CommunityPreview({
    posts,
    isLoading,
    error,
    onUpvote,
    canUpvote = false,
    onVote,
    canVote = false,
    limit = 3,
    showHeader = true,
}) {
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
                            Discussions, polls, news, and fan takes from AnimeVerse members.
                        </p>
                    </div>
                    <Link
                        to={PATHS.community}
                        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-white"
                    >
                        Open community <ArrowRight className="h-4 w-4" />
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
                    title="No posts yet"
                    message="Start a discussion from the Community page."
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
