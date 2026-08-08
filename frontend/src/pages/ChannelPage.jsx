import { useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Film, ListVideo, Info } from "lucide-react";
import { ErrorState } from "@/components/common/ErrorState";
import { EmptyState } from "@/components/common/EmptyState";
import { InfiniteVideoGrid } from "@/features/video/InfiniteVideoGrid";
import { PlaylistCard, PlaylistCardSkeleton } from "@/features/playlist/PlaylistCard";
import { useInfiniteVideos } from "@/features/video/hooks";
import { useUserPlaylists } from "@/features/playlist/hooks";
import { useChannel } from "@/features/channel/hooks";
import { ChannelHeader, ChannelHeaderSkeleton } from "@/features/channel/ChannelHeader";
import { cn } from "@/utils/cn";
import { formatViews } from "@/utils/format";

const TABS = [
    { id: "videos", label: "Videos", icon: Film },
    { id: "playlists", label: "Playlists", icon: ListVideo },
    { id: "about", label: "About", icon: Info },
];

/**
 * Kept as a child component so useInfiniteVideos only mounts once the channel's
 * _id is known. useInfiniteVideos takes no `enabled` flag, so calling it from the
 * page while the channel was still loading would fire one request with no userId
 * — i.e. fetch every video on the platform. Mounting late avoids that entirely.
 *
 * Published-only is enforced server-side by getAllVideos (isPublished: true).
 */
function VideosTab({ channel }) {
    const query = useInfiniteVideos({
        userId: channel._id,
        sortBy: "createdAt",
        sortType: "desc",
    });

    return (
        <InfiniteVideoGrid
            query={query}
            emptyTitle="No videos yet"
            emptyMessage={`${channel.fullName || channel.username} hasn't published any videos.`}
        />
    );
}

/**
 * Reuses the existing GET /playlist/user/:userId via useUserPlaylists and the
 * existing PlaylistCard — no new playlist API and no new card design.
 */
function PlaylistsTab({ channel }) {
    const { data, isLoading, error, refetch } = useUserPlaylists(channel?._id);

    if (error) {
        return (
            <ErrorState
                title="Couldn't load playlists"
                message="Something went wrong while fetching this creator's collections."
                onRetry={refetch}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <PlaylistCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (!data?.length) {
        return (
            <EmptyState
                icon={ListVideo}
                title="No playlists yet"
                message="This creator hasn't published any collections."
            />
        );
    }

    return (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.map((playlist) => (
                <PlaylistCard key={playlist._id} playlist={playlist} />
            ))}
        </div>
    );
}

/**
 * Only renders fields the User model / channel endpoint actually returns:
 * fullName, username, subscribersCount, channelsSubscribedToCount, createdAt.
 * There is no bio, location, or social-link field in the schema, so none is shown.
 */
function AboutTab({ channel }) {
    const joined = channel?.createdAt
        ? new Date(channel.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
          })
        : null;

    const rows = [
        { label: "Full name", value: channel?.fullName || "—" },
        { label: "Username", value: `@${channel?.username}` },
        {
            label: "Subscribers",
            value: formatViews(channel?.subscribersCount ?? 0),
        },
        {
            label: "Subscribed to",
            value: `${formatViews(channel?.channelsSubscribedToCount ?? 0)} channels`,
        },
        ...(joined ? [{ label: "Joined", value: joined }] : []),
    ];

    return (
        <div className="card-base max-w-xl p-5">
            <h3 className="font-display text-base font-semibold text-white">
                Channel details
            </h3>
            <dl className="mt-4 space-y-3">
                {rows.map((row) => (
                    <div
                        key={row.label}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-3 last:border-0 last:pb-0"
                    >
                        <dt className="text-xs uppercase tracking-wide text-muted">
                            {row.label}
                        </dt>
                        <dd className="text-sm text-white">{row.value}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

export default function ChannelPage() {
    const { username } = useParams();
    const [tab, setTab] = useState("videos");

    const channelQuery = useChannel(username);
    const channel = channelQuery.data;

    if (channelQuery.isLoading) {
        return (
            <div className="space-y-6">
                <ChannelHeaderSkeleton />
            </div>
        );
    }

    // A missing channel returns 404 "Channel does not exist" from the backend.
    if (channelQuery.error || !channel) {
        const status = channelQuery.error?.response?.status;
        return status === 404 ? (
            <ErrorState
                title="Channel not found"
                message={`No creator exists at @${username}. The link may be wrong or the channel was removed.`}
            />
        ) : (
            <ErrorState
                title="Couldn't load this channel"
                message="Something went wrong while fetching this creator's profile."
                onRetry={channelQuery.refetch}
            />
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
        >
            <ChannelHeader channel={channel} />

            {/* Tabs */}
            <div
                role="tablist"
                aria-label="Channel sections"
                className="flex gap-2 overflow-x-auto border-b border-white/5 pb-px"
            >
                {TABS.map(({ id, label, icon: Icon }) => {
                    const active = tab === id;
                    return (
                        <button
                            key={id}
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(id)}
                            className={cn(
                                "relative inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
                                active
                                    ? "text-white"
                                    : "text-muted hover:text-white/80"
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                            {active && (
                                <motion.span
                                    layoutId="channel-tab"
                                    className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-primary to-accent"
                                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            {tab === "videos" && <VideosTab channel={channel} />}
            {tab === "playlists" && <PlaylistsTab channel={channel} />}
            {tab === "about" && <AboutTab channel={channel} />}
        </motion.div>
    );
}
