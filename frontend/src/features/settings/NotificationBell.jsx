import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { Avatar } from "@/components/ui/Avatar";
import { Dropdown, DropdownLabel } from "@/components/ui/Dropdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { timeAgo } from "@/utils/format";
import { useNotifications, useMarkNotificationsRead } from "./hooks";

/**
 * The navbar bell, backed by GET /users/notifications.
 *
 * The dot used to be hardcoded, so it was lit permanently whether or not anything
 * had happened. It now reflects the server's unreadCount, which is computed
 * against notificationsLastReadAt and only counts categories the user still has
 * switched on in Settings.
 *
 * Only rendered for a signed-in user (see Navbar), so the query never fires for a
 * guest and can't produce a 401.
 */
export function NotificationBell() {
    const navigate = useNavigate();
    const { data, isLoading, isError } = useNotifications();
    const markRead = useMarkNotificationsRead();
    const [open, setOpen] = useState(false);
    const markedRef = useRef(false);

    const items = data?.notifications || [];
    const unreadCount = data?.unreadCount || 0;

    /**
     * Opening the tray is what marks it read — that is the whole meaning of
     * notificationsLastReadAt. Guarded by a ref so re-renders while the dropdown
     * is open don't fire repeated POSTs, and reset on close so the next open
     * stamps again.
     */
    useEffect(() => {
        if (!open) {
            markedRef.current = false;
            return;
        }
        if (markedRef.current || unreadCount === 0 || markRead.isPending) return;
        markedRef.current = true;
        markRead.mutate();
    }, [open, unreadCount, markRead]);

    return (
        <Dropdown
            onOpenChange={setOpen}
            trigger={
                <IconButton
                    aria-label={
                        unreadCount > 0
                            ? `Notifications, ${unreadCount} unread`
                            : "Notifications"
                    }
                >
                    <span className="relative">
                        <Bell className="h-5 w-5" />
                        {unreadCount > 0 && (
                            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg,#0f172a)]" />
                        )}
                    </span>
                </IconButton>
            }
        >
            <DropdownLabel>Notifications</DropdownLabel>

            {isLoading ? (
                <div className="space-y-2 px-3 py-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
            ) : isError ? (
                <div className="px-3 py-6 text-center text-sm text-muted">
                    Couldn't load notifications.
                </div>
            ) : items.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted">
                    You're all caught up.
                </div>
            ) : (
                <div className="max-h-80 overflow-y-auto">
                    {items.map((n) => {
                        const clickable = !!n.videoId;
                        return (
                            <button
                                key={n.id}
                                type="button"
                                disabled={!clickable}
                                onClick={
                                    clickable ? () => navigate(`/watch/${n.videoId}`) : undefined
                                }
                                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                                    clickable ? "hover:bg-white/10" : "cursor-default"
                                }`}
                            >
                                <Avatar
                                    size="sm"
                                    src={n.actor?.avatar}
                                    name={n.actor?.fullName || n.actor?.username}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm text-white/90">
                                        <span className="font-medium">
                                            {n.actor?.fullName || n.actor?.username || "Someone"}
                                        </span>{" "}
                                        <span className="text-muted">{n.text}</span>
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted">
                                        {timeAgo(n.createdAt)}
                                    </span>
                                </span>
                                {n.isUnread && (
                                    <span
                                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                                        aria-label="Unread"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </Dropdown>
    );
}
