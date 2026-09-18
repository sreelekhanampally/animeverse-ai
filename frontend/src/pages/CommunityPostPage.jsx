import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft,
    BarChart3,
    Check,
    Heart,
    Image as ImageIcon,
    MessageCircle,
    Newspaper,
    Reply,
    Send,
    Trash2,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import {
    useAddCommunityComment,
    useCommunityComments,
    useCommunityPost,
    useDeleteCommunityComment,
    useUpvoteCommunityPost,
    useVoteCommunityPost,
} from "@/features/community/hooks";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { PATHS, channelPath } from "@/routes/paths";
import { timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

const typeIcon = {
    discussion: MessageCircle,
    news: Newspaper,
    poll: BarChart3,
    meme: ImageIcon,
};

function CommentComposer({ onSubmit, submitting, placeholder = "Write a reply...", autoFocus = false }) {
    const [value, setValue] = useState("");

    const submit = async (event) => {
        event.preventDefault();
        const content = value.trim();
        if (!content) return;
        const ok = await onSubmit(content);
        if (ok !== false) setValue("");
    };

    return (
        <form onSubmit={submit} className="flex gap-2">
            <textarea
                autoFocus={autoFocus}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={1200}
                rows={2}
                placeholder={placeholder}
                className="min-h-[72px] flex-1 resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-muted focus:border-primary/50"
            />
            <button
                type="submit"
                disabled={!value.trim() || submitting}
                className="btn-primary self-end disabled:cursor-not-allowed disabled:opacity-50"
            >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Reply</span>
            </button>
        </form>
    );
}

function CommentRow({ comment, replies, user, onReply, onDelete, deleting }) {
    const [replying, setReplying] = useState(false);
    const author = comment.author || {};
    const mine = user?._id && String(author._id) === String(user._id);
    const deleted = comment.content === "[deleted]";

    return (
        <div className="space-y-3">
            <div className="flex gap-3">
                {author.username && !deleted ? (
                    <Link to={channelPath(author.username)} className="shrink-0">
                        <Avatar size="sm" src={author.avatar} name={author.fullName || author.username} />
                    </Link>
                ) : (
                    <Avatar size="sm" src={author.avatar} name={author.fullName || author.username || "?"} />
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {author.username && !deleted ? (
                            <Link to={channelPath(author.username)} className="font-medium text-white hover:text-accent">
                                {author.fullName || author.username}
                            </Link>
                        ) : (
                            <span className="font-medium text-white">{deleted ? "Deleted comment" : "AnimeVerse member"}</span>
                        )}
                        <span>·</span>
                        <span>{timeAgo(comment.createdAt)}</span>
                    </div>
                    <p className={cn("mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed", deleted ? "italic text-muted" : "text-white/90")}> 
                        {deleted ? "This comment was deleted." : comment.content}
                    </p>

                    {!deleted && (
                        <div className="mt-2 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setReplying((current) => !current)}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-white/5 hover:text-white"
                            >
                                <Reply className="h-3.5 w-3.5" /> Reply
                            </button>
                            {mine && (
                                <button
                                    type="button"
                                    disabled={deleting}
                                    onClick={() => onDelete(comment._id)}
                                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
                                >
                                    <Trash2 className="h-3.5 w-3.5" /> Delete
                                </button>
                            )}
                        </div>
                    )}

                    {replying && (
                        <div className="mt-3">
                            <CommentComposer
                                autoFocus
                                submitting={false}
                                placeholder={`Reply to ${author.fullName || author.username || "this comment"}`}
                                onSubmit={async (content) => {
                                    const ok = await onReply(content, comment._id);
                                    if (ok !== false) setReplying(false);
                                    return ok;
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {replies.length > 0 && (
                <div className="ml-8 space-y-4 border-l border-white/10 pl-4 sm:ml-11">
                    {replies.map((reply) => (
                        <CommentRow
                            key={reply._id}
                            comment={reply}
                            replies={[]}
                            user={user}
                            onReply={onReply}
                            onDelete={onDelete}
                            deleting={deleting}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function CommunityPostPage() {
    const { postId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const toast = useToast();
    const postQuery = useCommunityPost(postId);
    const commentsQuery = useCommunityComments(postId);
    const upvote = useUpvoteCommunityPost();
    const vote = useVoteCommunityPost();
    const addComment = useAddCommunityComment(postId);
    const deleteComment = useDeleteCommunityComment(postId);

    const post = postQuery.data;
    const comments = commentsQuery.data || [];
    const author = post?.author || {};
    const TypeIcon = typeIcon[post?.type] || MessageCircle;

    const roots = useMemo(() => comments.filter((comment) => !comment.parent), [comments]);
    const repliesByParent = useMemo(() => {
        const map = new Map();
        comments.forEach((comment) => {
            if (!comment.parent) return;
            const key = String(comment.parent);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(comment);
        });
        return map;
    }, [comments]);

    const handleUpvote = async () => {
        if (!user) return toast.info("Sign in to upvote posts");
        try {
            await upvote.mutateAsync(postId);
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't update the upvote"));
        }
    };

    const handleVote = async (optionIndex) => {
        if (!user) return toast.info("Sign in to vote in polls");
        try {
            await vote.mutateAsync({ postId, optionIndex });
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't record your vote"));
        }
    };

    const handleComment = async (content, parentId = null) => {
        if (!user) {
            toast.info("Sign in to join the discussion");
            return false;
        }
        try {
            await addComment.mutateAsync({ content, parentId });
            return true;
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't add your reply"));
            return false;
        }
    };

    const handleDeleteComment = async (commentId) => {
        try {
            await deleteComment.mutateAsync(commentId);
            toast.success("Reply deleted");
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't delete your reply"));
        }
    };

    if (postQuery.isLoading) {
        return (
            <div className="mx-auto max-w-4xl space-y-4">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-52 w-full rounded-2xl" />
                <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
        );
    }

    if (postQuery.error || !post) {
        return (
            <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-card/60 p-8 text-center">
                <h1 className="font-display text-xl font-semibold text-white">Post not found</h1>
                <p className="mt-2 text-sm text-muted">It may have been removed.</p>
                <button onClick={() => navigate(PATHS.community)} className="btn-primary mt-5">Back to Community</button>
            </div>
        );
    }

    const totalVotes = (post.pollOptions || []).reduce((sum, option) => sum + Number(option.votes || 0), 0);

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <Link to={PATHS.community} className="inline-flex items-center gap-2 text-sm text-muted hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Back to Community
            </Link>

            <article className="rounded-2xl border border-white/10 bg-card/60 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                    {author.username ? (
                        <Link to={channelPath(author.username)}>
                            <Avatar size="md" src={author.avatar} name={author.fullName || author.username} />
                        </Link>
                    ) : (
                        <Avatar size="md" src={author.avatar} name={author.fullName || author.username} />
                    )}
                    <div className="min-w-0 flex-1">
                        {author.username ? (
                            <Link to={channelPath(author.username)} className="font-medium text-white hover:text-accent">
                                {author.fullName || author.username}
                            </Link>
                        ) : (
                            <div className="font-medium text-white">AnimeVerse member</div>
                        )}
                        <div className="mt-0.5 text-xs text-muted">{timeAgo(post.createdAt)}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted">
                        <TypeIcon className="h-3 w-3" /> {post.type}
                    </span>
                </div>

                <h1 className="mt-5 font-display text-2xl font-semibold text-white sm:text-3xl">{post.title}</h1>
                {post.content && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/85 sm:text-base">{post.content}</p>
                )}

                {post.imageUrl && (
                    <img
                        src={post.imageUrl}
                        alt={post.title}
                        className="mt-5 max-h-[520px] w-full rounded-2xl border border-white/5 object-cover"
                    />
                )}

                {post.type === "poll" && Array.isArray(post.pollOptions) && post.pollOptions.length > 0 && (
                    <div className="mt-6 space-y-2">
                        {post.pollOptions.map((option, index) => {
                            const selected = post.selectedPollOption === index;
                            const votes = Number(option.votes || 0);
                            const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                            return (
                                <button
                                    key={`${post._id}-poll-${index}`}
                                    type="button"
                                    onClick={() => handleVote(index)}
                                    aria-pressed={selected}
                                    className={cn(
                                        "relative flex w-full items-center overflow-hidden rounded-xl border px-3 py-3 text-left text-sm transition",
                                        selected
                                            ? "border-accent/50 bg-accent/15 text-white"
                                            : "border-white/10 bg-white/[0.03] text-white/80 hover:border-accent/30"
                                    )}
                                >
                                    <span
                                        className="absolute inset-y-0 left-0 bg-white/[0.04]"
                                        style={{ width: `${percent}%` }}
                                        aria-hidden="true"
                                    />
                                    <span className="relative flex min-w-0 flex-1 items-center gap-2">
                                        {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                                        <span>{option.text}</span>
                                    </span>
                                    <span className="relative ml-3 shrink-0 text-xs text-muted">{percent}% · {votes}</span>
                                </button>
                            );
                        })}
                        <div className="pt-1 text-xs text-muted">
                            {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
                            {Number.isInteger(post.selectedPollOption) ? " · Your vote is marked" : ""}
                        </div>
                    </div>
                )}

                <div className="mt-6 flex items-center gap-4 border-t border-white/10 pt-4 text-sm text-muted">
                    <button
                        type="button"
                        onClick={handleUpvote}
                        aria-pressed={!!post.hasUpvoted}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition",
                            post.hasUpvoted ? "text-rose-300" : "hover:bg-white/5 hover:text-rose-300"
                        )}
                    >
                        <Heart className={cn("h-4 w-4", post.hasUpvoted && "fill-current")} />
                        {post.upvoteCount || 0}
                    </button>
                    <span className="inline-flex items-center gap-1.5">
                        <MessageCircle className="h-4 w-4" /> {post.commentCount || 0} {(post.commentCount || 0) === 1 ? "reply" : "replies"}
                    </span>
                </div>
            </article>

            <section className="rounded-2xl border border-white/10 bg-card/50 p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-display text-xl font-semibold text-white">Discussion</h2>
                        <p className="mt-1 text-sm text-muted">{comments.length} {comments.length === 1 ? "reply" : "replies"}</p>
                    </div>
                </div>

                {user ? (
                    <CommentComposer
                        submitting={addComment.isPending}
                        placeholder="Add to the discussion..."
                        onSubmit={(content) => handleComment(content)}
                    />
                ) : (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-muted">
                        Sign in to reply or vote.
                    </div>
                )}

                <div className="mt-6 border-t border-white/10 pt-6">
                    {commentsQuery.isLoading ? (
                        <div className="space-y-5">
                            <Skeleton className="h-20 w-full rounded-xl" />
                            <Skeleton className="h-20 w-full rounded-xl" />
                        </div>
                    ) : roots.length === 0 ? (
                        <EmptyState
                            icon={MessageCircle}
                            title="No replies yet"
                            message="Start the discussion."
                        />
                    ) : (
                        <div className="space-y-6">
                            {roots.map((comment) => (
                                <CommentRow
                                    key={comment._id}
                                    comment={comment}
                                    replies={repliesByParent.get(String(comment._id)) || []}
                                    user={user}
                                    onReply={handleComment}
                                    onDelete={handleDeleteComment}
                                    deleting={deleteComment.isPending}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
