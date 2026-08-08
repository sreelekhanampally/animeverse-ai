import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
    LayoutDashboard,
    Plus,
    Video as VideoIcon,
    Eye,
    ThumbsUp,
    Users,
    Pencil,
    Trash2,
    EyeOff,
    Upload,
} from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LazyImage } from "@/components/common/LazyImage";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { formatViews, formatDuration, timeAgo } from "@/utils/format";
import { PATHS } from "@/routes/paths";
import {
    useDashboardStats,
    useMyVideos,
    useDeleteVideo,
    useTogglePublish,
} from "@/features/dashboard/hooks";
import { EditVideoModal } from "@/features/dashboard/EditVideoModal";

function StatCard({ icon: Icon, label, value, loading }) {
    return (
        <Card className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/25 text-white">
                <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
                {loading ? (
                    <Skeleton className="mt-1 h-7 w-16" />
                ) : (
                    <div className="font-display text-2xl font-semibold text-white">{value}</div>
                )}
            </div>
        </Card>
    );
}

function VideoRowSkeleton() {
    return (
        <Card className="flex flex-col gap-4 sm:flex-row">
            <Skeleton className="aspect-video w-full rounded-xl sm:w-48" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-24" />
            </div>
        </Card>
    );
}

function VideoRow({ video, onEdit, onDelete, onTogglePublish, togglePending }) {
    const published = video.isPublished !== false;

    return (
        <Card className="flex flex-col gap-4 sm:flex-row">
            <Link
                to={`/watch/${video._id}`}
                className="relative block w-full shrink-0 overflow-hidden rounded-xl sm:w-48"
                aria-label={`Watch ${video.title}`}
            >
                <LazyImage
                    src={video.thumbnail}
                    alt={video.title}
                    wrapperClassName="aspect-video w-full rounded-xl bg-white/[0.04]"
                />
                {video.duration > 0 && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {formatDuration(video.duration)}
                    </span>
                )}
            </Link>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                        to={`/watch/${video._id}`}
                        className="min-w-0 font-display text-base font-semibold text-white hover:text-accent"
                    >
                        <span className="line-clamp-2">{video.title}</span>
                    </Link>
                    <Badge variant={published ? "success" : "default"}>
                        {published ? "Published" : "Unpublished"}
                    </Badge>
                </div>

                {video.description && (
                    <p className="line-clamp-2 text-sm text-muted">{video.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" /> {formatViews(video.views)} views
                    </span>
                    {typeof video.likesCount === "number" && (
                        <span className="inline-flex items-center gap-1">
                            <ThumbsUp className="h-3.5 w-3.5" /> {formatViews(video.likesCount)}
                        </span>
                    )}
                    {video.createdAt && <span>{timeAgo(video.createdAt)}</span>}
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(video)}>
                        <Pencil className="h-4 w-4" /> Edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        loading={togglePending}
                        disabled={togglePending}
                        onClick={() => onTogglePublish(video)}
                    >
                        {published ? (
                            <>
                                <EyeOff className="h-4 w-4" /> Unpublish
                            </>
                        ) : (
                            <>
                                <Eye className="h-4 w-4" /> Publish
                            </>
                        )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(video)}>
                        <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                </div>
            </div>
        </Card>
    );
}

export default function DashboardPage() {
    const navigate = useNavigate();
    const toast = useToast();

    const stats = useDashboardStats();
    const videos = useMyVideos();
    const del = useDeleteVideo();
    const toggle = useTogglePublish();

    const [editing, setEditing] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    // Tracks which row is mid-toggle so only that button shows a spinner.
    const [togglingId, setTogglingId] = useState(null);
    // A ref, not state: state updates are batched, so several clicks fired in the
    // same tick would all read the old value and each send a request. A ref flips
    // synchronously, so only the first click gets through.
    const busyRef = useRef(false);
    const deletingRef = useRef(false);

    const list = videos.data || [];

    const onTogglePublish = async (video) => {
        if (busyRef.current) return; // prevent duplicate clicks while pending
        busyRef.current = true;
        setTogglingId(video._id);
        try {
            await toggle.mutateAsync(video._id);
            toast.success(
                video.isPublished !== false ? "Video unpublished" : "Video published"
            );
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't change publish status"));
        } finally {
            busyRef.current = false;
            setTogglingId(null);
        }
    };

    const onDelete = async () => {
        // Same synchronous guard as the toggle: the confirm button can be
        // double-clicked before `isPending` has a chance to disable it.
        if (!confirmDelete || deletingRef.current) return;
        deletingRef.current = true;
        try {
            await del.mutateAsync(confirmDelete._id);
            toast.success("Video deleted");
            setConfirmDelete(null);
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't delete this video"));
        } finally {
            deletingRef.current = false;
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
        >
            <SectionHeader
                icon={LayoutDashboard}
                title="Creator Dashboard"
                subtitle="Manage your uploads, stats, and publishing."
                action={
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(PATHS.upload)}
                    >
                        <Plus className="h-4 w-4" /> Upload Video
                    </Button>
                }
            />

            {/* Overview statistics — all computed server-side by /dashboard/stats */}
            {stats.error ? (
                <ErrorState
                    title="Couldn't load your stats"
                    message="Something went wrong while fetching your channel totals."
                    onRetry={stats.refetch}
                />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                        icon={VideoIcon}
                        label="Videos"
                        loading={stats.isLoading}
                        value={formatViews(stats.data?.totalVideos ?? 0)}
                    />
                    <StatCard
                        icon={Eye}
                        label="Views"
                        loading={stats.isLoading}
                        value={formatViews(stats.data?.totalViews ?? 0)}
                    />
                    <StatCard
                        icon={ThumbsUp}
                        label="Likes"
                        loading={stats.isLoading}
                        value={formatViews(stats.data?.totalLikes ?? 0)}
                    />
                    <StatCard
                        icon={Users}
                        label="Subscribers"
                        loading={stats.isLoading}
                        value={formatViews(stats.data?.totalSubscribers ?? 0)}
                    />
                </div>
            )}

            <div>
                <SectionHeader title="My Videos" subtitle="Everything you've uploaded." />

                {videos.error ? (
                    <ErrorState
                        title="Couldn't load your videos"
                        message="Something went wrong while fetching your uploads."
                        onRetry={videos.refetch}
                    />
                ) : videos.isLoading ? (
                    <div className="space-y-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <VideoRowSkeleton key={i} />
                        ))}
                    </div>
                ) : list.length === 0 ? (
                    <EmptyState
                        icon={VideoIcon}
                        title="No videos yet"
                        message="Publish your first video and it will show up here with its stats."
                        action={
                            <Button variant="primary" onClick={() => navigate(PATHS.upload)}>
                                <Upload className="h-4 w-4" /> Upload your first video
                            </Button>
                        }
                    />
                ) : (
                    <div className="space-y-4">
                        {list.map((video) => (
                            <VideoRow
                                key={video._id}
                                video={video}
                                onEdit={setEditing}
                                onDelete={setConfirmDelete}
                                onTogglePublish={onTogglePublish}
                                togglePending={togglingId === video._id}
                            />
                        ))}
                    </div>
                )}
            </div>

            <EditVideoModal
                open={!!editing}
                video={editing}
                onClose={() => setEditing(null)}
            />

            <ConfirmDialog
                open={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={onDelete}
                loading={del.isPending}
                title="Delete this video permanently?"
                message={
                    confirmDelete
                        ? `“${confirmDelete.title}” and its thumbnail will be removed from Cloudinary and your channel. This can't be undone.`
                        : ""
                }
                confirmText="Delete"
            />
        </motion.div>
    );
}
