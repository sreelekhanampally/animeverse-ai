import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListVideo, Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Button } from "@/components/ui/Button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/Dropdown";
import { ConfirmDialog } from "@/components/ui/Modal";
import { PlaylistCard, PlaylistCardSkeleton } from "@/features/playlist/PlaylistCard";
import { PlaylistFormModal } from "@/features/playlist/PlaylistFormModal";
import {
    useDeletePlaylist,
    useMyPlaylists,
} from "@/features/playlist/hooks";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";

export default function PlaylistsPage() {
    const toast = useToast();
    const { data, isLoading, error, refetch } = useMyPlaylists();
    const del = useDeletePlaylist();

    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);

    const onDelete = async () => {
        if (!confirmDelete) return;
        try {
            await del.mutateAsync(confirmDelete._id);
            toast.success("Playlist deleted");
            setConfirmDelete(null);
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't delete playlist"));
        }
    };

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={ListVideo}
                title="Playlists"
                subtitle="Your curated queues and watch collections."
                action={
                    <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4" /> New playlist
                    </Button>
                }
            />

            {error ? (
                <ErrorState
                    title="Couldn't load playlists"
                    message="Something went wrong while fetching your collections."
                    onRetry={refetch}
                />
            ) : isLoading ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <PlaylistCardSkeleton key={i} />
                    ))}
                </div>
            ) : !data || data.length === 0 ? (
                <EmptyState
                    icon={ListVideo}
                    title="No playlists yet"
                    message="Save videos into playlists to marathon them later."
                    action={
                        <Button variant="primary" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-4 w-4" /> Create your first playlist
                        </Button>
                    }
                />
            ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    <AnimatePresence initial={false}>
                        {data.map((p) => (
                            <motion.div
                                key={p._id}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96 }}
                                transition={{ duration: 0.2 }}
                                className="relative"
                            >
                                <PlaylistCard playlist={p} />
                                <div className="absolute right-2 top-2">
                                    <Dropdown
                                        trigger={
                                            <button
                                                className="rounded-lg border border-white/10 bg-black/50 p-1.5 text-white/85 backdrop-blur transition hover:bg-white/15"
                                                aria-label="Playlist actions"
                                            >
                                                <MoreHorizontal className="h-4 w-4" />
                                            </button>
                                        }
                                    >
                                        <DropdownItem
                                            icon={<Pencil className="h-4 w-4" />}
                                            onClick={() => setEditing(p)}
                                        >
                                            Rename / Edit
                                        </DropdownItem>
                                        <DropdownSeparator />
                                        <DropdownItem
                                            icon={<Trash2 className="h-4 w-4" />}
                                            danger
                                            onClick={() => setConfirmDelete(p)}
                                        >
                                            Delete
                                        </DropdownItem>
                                    </Dropdown>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}

            <PlaylistFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
            <PlaylistFormModal
                open={!!editing}
                onClose={() => setEditing(null)}
                playlist={editing}
            />
            <ConfirmDialog
                open={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={onDelete}
                loading={del.isPending}
                title="Delete this playlist?"
                message={
                    confirmDelete
                        ? `“${confirmDelete.name}” and its ${confirmDelete.videos?.length ?? 0} saved video(s) will be removed from your library.`
                        : ""
                }
                confirmText="Delete"
            />
        </div>
    );
}
