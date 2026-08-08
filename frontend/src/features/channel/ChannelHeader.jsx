import { useRef } from "react";
import { Bell, BadgeCheck } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { LazyImage } from "@/components/common/LazyImage";
import { formatViews } from "@/utils/format";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { cn } from "@/utils/cn";
import { useToggleChannelSubscribe } from "./hooks";

export function ChannelHeaderSkeleton() {
    return (
        <div>
            <Skeleton className="h-32 w-full rounded-2xl sm:h-44 lg:h-56" />
            <div className="mt-4 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
                <Skeleton className="h-20 w-20 shrink-0 rounded-full sm:h-24 sm:w-24" />
                <div className="w-full space-y-2">
                    <Skeleton className="mx-auto h-6 w-48 sm:mx-0" />
                    <Skeleton className="mx-auto h-4 w-32 sm:mx-0" />
                    <Skeleton className="mx-auto h-4 w-40 sm:mx-0" />
                </div>
                <Skeleton className="h-10 w-32 rounded-full" />
            </div>
        </div>
    );
}

export function ChannelHeader({ channel }) {
    const { user } = useAuth();
    const toast = useToast();
    const toggle = useToggleChannelSubscribe(channel?.username, channel?._id);
    // A ref, not `toggle.isPending`: that's state, so it only lands a render
    // later. Several clicks in the same tick would all read `false` before the
    // button re-renders as disabled, and each would send its own POST. A ref
    // flips synchronously, so only the first click gets through.
    const busyRef = useRef(false);

    if (!channel) return null;

    const isSubscribed = !!channel.isSubscribed;
    // The backend rejects self-subscription with a 400, so don't offer the button.
    const isOwnChannel = !!user && user._id === channel._id;

    const onToggle = async () => {
        if (!user) return toast.info("Sign in to subscribe");
        if (toggle.isPending || busyRef.current) return;
        busyRef.current = true;
        try {
            await toggle.mutateAsync();
        } catch (e) {
            toast.error(extractErrorMessage(e, "Couldn't update subscription"));
        } finally {
            busyRef.current = false;
        }
    };

    return (
        <div>
            {/* Banner — coverImage is optional in the User model (defaults to ""). */}
            <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-white/5 sm:h-44 lg:h-56">
                {channel.coverImage ? (
                    <LazyImage
                        src={channel.coverImage}
                        alt={`${channel.fullName || channel.username} banner`}
                        wrapperClassName="absolute inset-0 h-full w-full"
                    />
                ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/35 via-primary/10 to-accent/30" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-bg/80 to-transparent" />
            </div>

            {/* Desktop: avatar left, details, subscribe right. Mobile: stacked+centered. */}
            <div className="mt-4 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
                <div className="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:items-end">
                    <Avatar
                        src={channel.avatar}
                        name={channel.fullName || channel.username}
                        size="xl"
                        className="h-20 w-20 border-4 border-bg text-2xl sm:h-24 sm:w-24"
                    />
                    <div className="min-w-0">
                        <h1 className="flex items-center justify-center gap-1.5 font-display text-2xl font-semibold text-white sm:justify-start sm:text-3xl">
                            <span className="truncate">
                                {channel.fullName || channel.username}
                            </span>
                            {(channel.verified || channel.isVerified) && (
                                <BadgeCheck className="h-5 w-5 shrink-0 text-accent" />
                            )}
                        </h1>
                        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted sm:justify-start">
                            <span>@{channel.username}</span>
                            <span className="h-1 w-1 rounded-full bg-muted/60" />
                            <span>
                                {formatViews(channel.subscribersCount ?? 0)}{" "}
                                {channel.subscribersCount === 1
                                    ? "subscriber"
                                    : "subscribers"}
                            </span>
                        </div>
                    </div>
                </div>

                {!isOwnChannel && (
                    <button
                        onClick={onToggle}
                        disabled={toggle.isPending}
                        aria-pressed={isSubscribed}
                        className={cn(
                            "inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition active:scale-95 disabled:opacity-60",
                            isSubscribed
                                ? "border border-white/15 bg-white/[0.06] text-white/90 hover:bg-white/10"
                                : "bg-primary text-white shadow-glow hover:bg-primary-600"
                        )}
                    >
                        {isSubscribed ? (
                            <>
                                <Bell className="h-4 w-4" /> Subscribed
                            </>
                        ) : (
                            <>Subscribe</>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
