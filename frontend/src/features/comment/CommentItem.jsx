import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
    ThumbsUp,
    MessageSquare,
    Pencil,
    Trash2,
    MoreVertical,
    Pin,
    BadgeCheck,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/Dropdown";
import { cn } from "@/utils/cn";
import { timeAgo, formatViews } from "@/utils/format";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { CommentComposer } from "./CommentComposer";
import {
    useAddComment,
    useCommentReplies,
    useDeleteComment,
    useToggleCommentLike,
    useUpdateComment,
} from "./hooks";

export function CommentItem({ comment, videoId, depth = 0, pinnedId }) {
    const { user } = useAuth();
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [replying, setReplying] = useState(false);
    const [expandReplies, setExpandReplies] = useState(false);

    const owner = comment.owner || {};
    const isMine = user?._id && (owner._id === user._id || owner === user._id);
    const isPinned = pinnedId && pinnedId === comment._id;
    const isVerified = owner.verified || owner.isVerified;

    const toggleLike = useToggleCommentLike(videoId);
    const update = useUpdateComment(videoId);
    const del = useDeleteComment(videoId);
    const add = useAddComment(videoId);

    const replies = useCommentReplies(comment._id, expandReplies && (comment.repliesCount ?? 0) > 0);

    const onLike = () => {
        if (!user) return toast.info("Sign in to like comments");
        toggleLike.mutate(comment._id);
    };

    const onEditSubmit = async (v) => {
        try {
            await update.mutateAsync({ commentId: comment._id, content: v });
            setEditing(false);
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't update"));
        }
    };

    const onReplySubmit = async (v) => {
        try {
            await add.mutateAsync({ content: v, parentId: comment._id });
            setReplying(false);
            setExpandReplies(true);
            toast.success("Reply added");
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't reply"));
        }
    };

    const onDelete = async () => {
        try {
            await del.mutateAsync({ commentId: comment._id });
            toast.success("Comment deleted");
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't delete"));
        }
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
                "group flex gap-3",
                depth > 0 && "ml-8 border-l border-white/5 pl-4 sm:ml-11"
            )}
        >
            <Link to={owner.username ? `/c/${owner.username}` : "#"} className="shrink-0">
                <Avatar size="sm" src={owner.avatar} name={owner.fullName || owner.username} />
            </Link>
            <div className="min-w-0 flex-1">
                {isPinned && (
                    <div className="mb-1 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
                        <Pin className="h-3 w-3" /> Pinned
                    </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="font-medium text-white">
                        {owner.fullName || owner.username || "Anonymous"}
                    </span>
                    {isVerified && <BadgeCheck className="h-3.5 w-3.5 text-accent" />}
                    <span>·</span>
                    <span>{timeAgo(comment.createdAt)}</span>
                    {comment.edited && <span className="italic">(edited)</span>}
                </div>

                {editing ? (
                    <div className="mt-2">
                        <CommentComposer
                            autoFocus
                            initialValue={comment.content}
                            onSubmit={onEditSubmit}
                            onCancel={() => setEditing(false)}
                            submitting={update.isPending}
                            placeholder="Edit your comment"
                        />
                    </div>
                ) : (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">
                        {comment.content}
                    </p>
                )}

                <div className="mt-2 flex items-center gap-2">
                    <button
                        onClick={onLike}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition",
                            comment.isLiked
                                ? "text-primary"
                                : "text-muted hover:bg-white/10 hover:text-white"
                        )}
                        aria-pressed={!!comment.isLiked}
                    >
                        <ThumbsUp className={cn("h-3.5 w-3.5", comment.isLiked && "fill-current")} />
                        {formatViews(comment.likesCount ?? 0)}
                    </button>

                    {depth === 0 && (
                        <button
                            onClick={() => {
                                if (!user) return toast.info("Sign in to reply");
                                setReplying((v) => !v);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-white"
                        >
                            <MessageSquare className="h-3.5 w-3.5" /> Reply
                        </button>
                    )}

                    {isMine && !editing && (
                        <div className="ml-auto opacity-0 transition group-hover:opacity-100">
                            <Dropdown
                                trigger={
                                    <button
                                        className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-white"
                                        aria-label="Comment actions"
                                    >
                                        <MoreVertical className="h-4 w-4" />
                                    </button>
                                }
                            >
                                <DropdownItem
                                    icon={<Pencil className="h-4 w-4" />}
                                    onClick={() => setEditing(true)}
                                >
                                    Edit
                                </DropdownItem>
                                <DropdownSeparator />
                                <DropdownItem
                                    icon={<Trash2 className="h-4 w-4" />}
                                    danger
                                    onClick={onDelete}
                                >
                                    Delete
                                </DropdownItem>
                            </Dropdown>
                        </div>
                    )}
                </div>

                <AnimatePresence>
                    {replying && (
                        <motion.div
                            initial={{ opacity: 0, y: -4, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3"
                        >
                            <CommentComposer
                                autoFocus
                                compact
                                onSubmit={onReplySubmit}
                                onCancel={() => setReplying(false)}
                                submitting={add.isPending}
                                placeholder={`Replying to @${owner.username || "user"}`}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                {depth === 0 && (comment.repliesCount ?? 0) > 0 && (
                    <div className="mt-2">
                        <button
                            onClick={() => setExpandReplies((v) => !v)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/10"
                        >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {expandReplies ? "Hide" : "View"} {comment.repliesCount} repl
                            {comment.repliesCount === 1 ? "y" : "ies"}
                        </button>
                        <AnimatePresence>
                            {expandReplies && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-2 space-y-3"
                                >
                                    {replies.isLoading && (
                                        <div className="ml-8 text-xs text-muted">Loading replies…</div>
                                    )}
                                    {replies.data?.map((r) => (
                                        <CommentItem
                                            key={r._id}
                                            comment={r}
                                            videoId={videoId}
                                            depth={depth + 1}
                                        />
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </motion.div>
    );
}