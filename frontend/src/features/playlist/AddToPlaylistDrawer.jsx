import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Plus, ListVideo, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import {
    useAddVideoToPlaylist,
    useMyPlaylists,
    useRemoveVideoFromPlaylist,
} from "./hooks";
import { PlaylistFormModal } from "./PlaylistFormModal";

export function AddToPlaylistDrawer({ open, onClose, videoId }) {
    const { user } = useAuth();
    const toast = useToast();
    const playlists = useMyPlaylists();
    const addVideo = useAddVideoToPlaylist();
    const removeVideo = useRemoveVideoFromPlaylist();
    const [createOpen, setCreateOpen] = useState(false);
    const [pendingId, setPendingId] = useState(null);

    const items = useMemo(() => playlists.data || [], [playlists.data]);
    const contains = (p) => {
        const list = p.videos || [];
        return list.some((v) => (v?._id || v) === videoId);
    };

    const toggle = async (p) => {
        if (!videoId) return;
        setPendingId(p._id);
        try {
            if (contains(p)) {
                await removeVideo.mutateAsync({ playlistId: p._id, videoId });
                toast.success(`Removed from “${p.name}”`);
            } else {
                await addVideo.mutateAsync({ playlistId: p._id, videoId });
                toast.success(`Added to “${p.name}”`);
            }
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't update playlist"));
        } finally {
            setPendingId(null);
        }
    };

    return (
        <>
            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
                            onClick={onClose}
                        />
                        <motion.aside
                            initial={{ x: "100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "100%" }}
                            transition={{ type: "tween", ease: "easeOut", duration: 0.25 }}
                            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col border-l border-white/10 bg-bg/95 backdrop-blur-2xl"
                            role="dialog"
                            aria-label="Save to playlist"
                        >
                            <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
                                <div>
                                    <div className="font-display text-lg font-semibold text-white">Save to playlist</div>
                                    <p className="mt-0.5 text-xs text-muted">Add this video to one of your collections.</p>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="rounded-lg p-2 text-muted hover:bg-white/10 hover:text-white"
                                    aria-label="Close"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="flex-1 space-y-2 overflow-y-auto p-4">
                                {!user ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-muted">
                                        Sign in to save videos to playlists.
                                    </div>
                                ) : playlists.isLoading ? (
                                    <div className="flex items-center justify-center py-10 text-muted">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    </div>
                                ) : items.length === 0 ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-muted">
                                        You don't have any playlists yet.
                                    </div>
                                ) : (
                                    items.map((p) => {
                                        const active = contains(p);
                                        return (
                                            <button
                                                key={p._id}
                                                onClick={() => toggle(p)}
                                                disabled={pendingId === p._id}
                                                className={cn(
                                                    "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                                                    active
                                                        ? "border-primary/50 bg-primary/10"
                                                        : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        "flex h-9 w-9 items-center justify-center rounded-xl",
                                                        active
                                                            ? "bg-primary/25 text-primary"
                                                            : "bg-white/[0.06] text-muted"
                                                    )}
                                                >
                                                    <ListVideo className="h-4 w-4" />
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-medium text-white">
                                                        {p.name}
                                                    </div>
                                                    <div className="text-[11px] text-muted">
                                                        {(p.videos?.length ?? p.videoCount ?? 0)} videos
                                                    </div>
                                                </div>
                                                {pendingId === p._id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted" />
                                                ) : active ? (
                                                    <Check className="h-4 w-4 text-primary" />
                                                ) : null}
                                            </button>
                                        );
                                    })
                                )}
                            </div>

                            <div className="border-t border-white/5 p-4">
                                <Button
                                    variant="primary"
                                    fullWidth
                                    onClick={() => setCreateOpen(true)}
                                    disabled={!user}
                                >
                                    <Plus className="h-4 w-4" /> New playlist
                                </Button>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>

            <PlaylistFormModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
            />
        </>
    );
}