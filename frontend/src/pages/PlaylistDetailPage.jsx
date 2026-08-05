import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    Play,
    Shuffle,
    Pencil,
    Trash2,
    ListVideo,
    Lock,
    Globe2,
    X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/ui/Modal";
import { LazyImage } from "@/components/common/LazyImage";
import {
    useDeletePlaylist,
    usePlaylist,
    useRemoveVideoFromPlaylist,
} from "@/features/playlist/hooks";
import { PlaylistFormModal } from "@/features/playlist/PlaylistFormModal";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { extractErrorMessage } from "@/services";
import { formatDuration, timeAgo } from "@/utils/format";
import { PATHS } from "@/routes/paths";
import { cn } from "@/utils/cn";

export default function PlaylistDetailPage() {
    const { playlistId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useAuth();
    const { data: playlist, isLoading, error, refetch } = usePlaylist(playlistId);
    const removeVideo = useRemoveVideoFromPlaylist();
    const del = useDeletePlaylist();
    const [editOpen, setEditOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const videos = useMemo(() => playlist?.videos || [], [playlist]);
    const isOwner = user?._id && (playlist?.owner?._id === user._id || playlist?.owner === user._id);

    const onPlayAll = () => {
        const first = videos[0];
        if (first?._id) navigate(`/watch/${first._id}`);
    };
    const onShuffle = () => {
        if (!videos.length) return;
        const i = Math.floor(Math.random() * videos.length);
        navigate(`/watch/${videos[i]._id}`);
    };

    const onRemove = async (videoId) => {
        try {
            await removeVideo.mutateAsync({ playlistId, videoId });
            toast.success("Removed from playlist");
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't remove"));
        }
    };

    const onDeletePlaylist = async () => {
        try {
            await del.mutateAsync(playlistId);
            toast.success("Playlist deleted");
            navigate(PATHS.playlists, { replace: true });
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't delete"));
        }
    };

    if (error) {
        return (
            <ErrorState
                title="Playlist unavailable"
                message="It may have been deleted or made private."
                onRetry={refetch}
            />
        );
    }

    return (
        <div className="space-y-6">
            <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1 text-sm text-muted hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" /> Back
            </button>

            <div className="grid gap-6 rounded-3xl border border-white/10 bg-gradient-to-br from-primary/20 via-transparent to-accent/15 p-6 md:grid-cols-[280px_1fr] md:p-8">
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 md:aspect-square">
                    {isLoading ? (
                        <Skeleton className="absolute inset-0 rounded-2xl" />
                    ) : videos[0]?.thumbnail || playlist?.thumbnail ? (
                        <LazyImage
                            src={playlist?.thumbnail || videos[0]?.thumbnail}
                            alt={playlist?.name}
                            wrapperClassName="absolute inset-0"
                        />
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-accent/25" />
                    )}
                    <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/50 px-2 py-1 text-[10px] text-white backdrop-blur">
                        <ListVideo className="h-3 w-3" /> {videos.length} videos
                    </div>
                </div>
                <div className="min-w-0 space-y-3">
                    {isLoading ? (
                        <>
                            <Skeleton className="h-7 w-2/3" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-14 w-full" />
                        </>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted">
                                <span>Playlist</span>
                                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/80">
                                    {playlist?.isPublic === false ? (
                                        <>
                                            <Lock className="h-3 w-3" /> Private
                                        </>
                                    ) : (
                                        <>
                                            <Globe2 className="h-3 w-3" /> Public
                                        </>
                                    )}
                                </span>
                            </div>
                            <h1 className="font-display text-3xl font-bold text-white">
                                {playlist?.name}
                            </h1>
                            {playlist?.description && (
                                <p className="max-w-2xl text-sm text-white/85">
                                    {playlist.description}
                                </p>
                            )}
                            <div className="text-xs text-muted">
                                Updated {timeAgo(playlist?.updatedAt || playlist?.createdAt)}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-2">
                                <Button variant="primary" onClick={onPlayAll} disabled={!videos.length}>
                                    <Play className="h-4 w-4" fill="currentColor" /> Play all
                                </Button>
                                <Button variant="ghost" onClick={onShuffle} disabled={!videos.length}>
                                    <Shuffle className="h-4 w-4" /> Shuffle
                                </Button>
                                {isOwner && (
                                    <>
                                        <Button variant="ghost" onClick={() => setEditOpen(true)}>
                                            <Pencil className="h-4 w-4" /> Edit
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            className="text-rose-300 hover:!bg-rose-500/10"
                                            onClick={() => setConfirmDelete(true)}
                                        >
                                            <Trash2 className="h-4 w-4" /> Delete
                                        </Button>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Video list */}
            <div className="space-y-2">
                {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full rounded-2xl" />
                    ))
                ) : videos.length === 0 ? (
                    <EmptyState
                        icon={ListVideo}
                        title="This playlist is empty"
                        message="Add videos from any watch page to build up your collection."
                    />
                ) : (
                    <AnimatePresence initial={false}>
                        {videos.map((v, i) => (
                            <motion.div
                                key={v._id}
                                layout
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="group flex items-center gap-3 rounded-2xl border border-white/5 bg-card/60 p-2 pr-3 backdrop-blur hover:bg-card/80"
                            >
                                <span className="w-6 shrink-0 text-center text-xs text-muted">
                                    {i + 1}
                                </span>
                                <Link
                                    to={`/watch/${v._id}`}
                                    className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-xl bg-black/60"
                                >
                                    <LazyImage
                                        src={v.thumbnail}
                                        alt={v.title}
                                        wrapperClassName="absolute inset-0"
                                    />
                                    {v.duration != null && (
                                        <span className="absolute bottom-1 right-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                                            {formatDuration(v.duration)}
                                        </span>
                                    )}
                                </Link>
                                <div className="min-w-0 flex-1">
                                    <Link
                                        to={`/watch/${v._id}`}
                                        className="line-clamp-2 text-sm font-semibold text-white hover:text-accent"
                                    >
                                        {v.title}
                                    </Link>
                                    <div className="mt-0.5 truncate text-[11px] text-muted">
                                        {v.owner?.fullName || v.owner?.username || "Creator"}
                                    </div>
                                </div>
                                {isOwner && (
                                    <button
                                        onClick={() => onRemove(v._id)}
                                        className={cn(
                                            "rounded-lg p-2 text-muted opacity-0 transition hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100",
                                            removeVideo.isPending && "opacity-100"
                                        )}
                                        aria-label="Remove from playlist"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>

            <PlaylistFormModal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                playlist={playlist}
            />
            <ConfirmDialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                onConfirm={onDeletePlaylist}
                loading={del.isPending}
                title="Delete this playlist?"
                message={`“${playlist?.name || "This playlist"}” will be removed from your library.`}
                confirmText="Delete"
            />
        </div>
    );
}
