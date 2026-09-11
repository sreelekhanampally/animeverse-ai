import { useState } from "react";
import { motion } from "framer-motion";
import { ThumbsUp, Share2, Bookmark, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { extractErrorMessage } from "@/services";
import { formatViews } from "@/utils/format";
import { cn } from "@/utils/cn";
import { useToggleVideoLike, useToggleWatchLater, useWatchLater } from "./hooks";
import { AddToPlaylistDrawer } from "@/features/playlist/AddToPlaylistDrawer";

export function VideoInfoActions({ video }) {
    const toast = useToast();
    const { user } = useAuth();
    const [savedOpen, setSavedOpen] = useState(false);
    const toggle = useToggleVideoLike(video?._id);
    const watchLaterList = useWatchLater();
    const watchLater = useToggleWatchLater(video);
    const isInWatchLater = Array.isArray(watchLaterList.data)
        ? watchLaterList.data.some((item) => item?._id === video?._id)
        : false;

    const onLike = async () => {
        if (!user) return toast.info("Sign in to like videos");
        try {
            await toggle.mutateAsync();
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't update like"));
        }
    };

    const onWatchLater = async () => {
        if (!user) return toast.info("Sign in to use Watch Later");
        if (!video?._id) return;
        try {
            const result = await watchLater.mutateAsync();
            toast.success(result?.isSaved ? "Saved to Watch Later" : "Removed from Watch Later");
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't update Watch Later"));
        }
    };

    const onShare = async () => {
        const url = window.location.href;
        try {
            if (navigator.share) {
                await navigator.share({ title: video?.title, url });
            } else {
                await navigator.clipboard.writeText(url);
                toast.success("Link copied to clipboard");
            }
        } catch {
            /* cancelled */
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={onLike}
                aria-pressed={!!video?.isLiked}
                className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                    video?.isLiked
                        ? "border-primary/60 bg-primary/20 text-white shadow-glow"
                        : "border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/10"
                )}
            >
                <ThumbsUp className={cn("h-4 w-4", video?.isLiked && "fill-current")} />
                {formatViews(video?.likesCount ?? 0)}
            </motion.button>

            <Button
                variant="ghost"
                size="md"
                onClick={onWatchLater}
                disabled={!video?._id || watchLater.isPending}
            >
                <Clock className="h-4 w-4" /> {isInWatchLater ? "In Watch Later" : "Watch Later"}
            </Button>

            <Button variant="ghost" size="md" onClick={() => setSavedOpen(true)} disabled={!video?._id}>
                <Bookmark className="h-4 w-4" /> Playlist
            </Button>

            <Button variant="ghost" size="md" onClick={onShare}>
                <Share2 className="h-4 w-4" /> Share
            </Button>


            <AddToPlaylistDrawer
                open={savedOpen}
                onClose={() => setSavedOpen(false)}
                videoId={video?._id}
            />
        </div>
    );
}
