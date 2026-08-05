import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BadgeCheck, Bell } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { formatViews } from "@/utils/format";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import { extractErrorMessage } from "@/services";
import { useToggleSubscribe } from "@/features/subscription/hooks";
import { cn } from "@/utils/cn";

export function CreatorCard({ owner, videoId }) {
    const toast = useToast();
    const { user } = useAuth();
    const toggle = useToggleSubscribe(owner?._id, videoId ? ["video", videoId] : null);
    if (!owner) return null;

    const isSubbed = !!owner.isSubscribed;
    const isVerified = owner.verified || owner.isVerified;

    const onToggle = async () => {
        if (!user) return toast.info("Sign in to subscribe");
        try {
            await toggle.mutateAsync();
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't update subscription"));
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
        >
            <Link
                to={owner.username ? `/c/${owner.username}` : "#"}
                className="flex min-w-0 items-center gap-3"
                onClick={(e) => !owner.username && e.preventDefault()}
            >
                <Avatar size="lg" src={owner.avatar} name={owner.fullName || owner.username} />
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate font-display text-base font-semibold text-white">
                            {owner.fullName || owner.username}
                        </span>
                        {isVerified && <BadgeCheck className="h-4 w-4 text-accent" />}
                    </div>
                    <div className="text-xs text-muted">
                        {formatViews(owner.subscribersCount ?? 0)} subscribers
                        {owner.videosCount != null && (
                            <> · {formatViews(owner.videosCount)} videos</>
                        )}
                    </div>
                </div>
            </Link>

            <div className="flex items-center gap-2">
                <button
                    onClick={onToggle}
                    disabled={toggle.isPending}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition active:scale-95 disabled:opacity-60",
                        isSubbed
                            ? "border border-white/15 bg-white/[0.06] text-white/90 hover:bg-white/10"
                            : "bg-primary text-white shadow-glow hover:bg-primary-600"
                    )}
                >
                    {isSubbed ? (
                        <>
                            <Bell className="h-4 w-4" /> Subscribed
                        </>
                    ) : (
                        <>Subscribe</>
                    )}
                </button>
            </div>
        </motion.div>
    );
}
