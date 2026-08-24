import { Link } from "react-router-dom";
import { Rss, Users } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { InfiniteVideoGrid } from "@/features/video/InfiniteVideoGrid";
import { useSubscribedChannels, useSubscriptionFeed } from "@/features/video/hooks";

/**
 * Horizontal rail of the channels the user subscribes to, above the feed —
 * the same affordance YouTube puts there. Reads the pre-existing
 * GET /subscriptions/u/:subscriberId endpoint; no new subscription API.
 */
function ChannelRail() {
    const { data, isLoading, error } = useSubscribedChannels();

    // A failure here must not take the feed down with it, so it degrades to
    // nothing rather than an error panel.
    if (error) return null;

    if (isLoading) {
        return (
            <div className="flex gap-4 overflow-x-auto pb-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex w-20 shrink-0 flex-col items-center gap-2">
                        <Skeleton className="h-14 w-14 rounded-full" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                ))}
            </div>
        );
    }

    const rows = data || [];
    if (!rows.length) return null;

    return (
        <div
            className="scrollbar-none flex gap-4 overflow-x-auto pb-2"
            style={{ scrollbarWidth: "none" }}
        >
            {rows.map((row) => {
                // GET /subscriptions/u/:id returns Subscription documents with a
                // populated `channel`. Fall back to the row itself in case a
                // caller ever hands this component plain user objects.
                const channel = row?.channel || row;
                if (!channel?._id) return null;
                return (
                    <Link
                        key={row?._id || channel._id}
                        to={channel.username ? `/c/${channel.username}` : "#"}
                        onClick={(e) => !channel.username && e.preventDefault()}
                        className="group flex w-20 shrink-0 flex-col items-center gap-2 text-center"
                    >
                        <Avatar
                            src={channel.avatar}
                            name={channel.fullName || channel.username}
                            size="xl"
                            className="h-14 w-14 transition group-hover:ring-2 group-hover:ring-primary/60"
                        />
                        <span className="w-full truncate text-[11px] text-white/80 group-hover:text-white">
                            {channel.fullName || channel.username}
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}

/**
 * Subscriptions.
 *
 * This page previously rendered a hardcoded <EmptyState title="No subscriptions
 * yet" /> and made no request, so it read as empty even for a user with
 * subscriptions in the database. There was also no endpoint that could answer
 * "videos from the channels I subscribe to" — GET /subscriptions/feed was added
 * for exactly this, paginated with the same envelope as GET /videos so the
 * existing InfiniteVideoGrid renders it unchanged.
 *
 * Subscribing or unsubscribing anywhere invalidates this feed's query key, so the
 * creator's videos appear (or disappear) without a manual refresh, and the state
 * survives reloads because it is read from MongoDB.
 */
export default function SubscriptionsPage() {
    const query = useSubscriptionFeed();
    const { data, isLoading, error, refetch } = query;

    if (error) {
        return (
            <div className="space-y-6">
                <SectionHeader
                    icon={Rss}
                    title="Subscriptions"
                    subtitle="Everything from the creators you follow."
                />
                <ErrorState
                    title="Couldn't load your subscriptions"
                    message="We hit a snag while pulling videos from your channels."
                    onRetry={refetch}
                />
            </div>
        );
    }

    const totalDocs = data?.pages?.[0]?.totalDocs ?? 0;
    const isEmpty = !isLoading && totalDocs === 0;

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Rss}
                title="Subscriptions"
                subtitle="Everything from the creators you follow."
            />

            <ChannelRail />

            {isEmpty ? (
                <EmptyState
                    icon={Users}
                    title="No subscriptions yet"
                    message="Follow creators to see their newest uploads here."
                />
            ) : (
                <InfiniteVideoGrid
                    query={query}
                    emptyTitle="Nothing new yet"
                    emptyMessage="The creators you follow haven't published anything yet."
                />
            )}
        </div>
    );
}
