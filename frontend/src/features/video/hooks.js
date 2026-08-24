import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import {
    videoService,
    likeService,
    historyService,
    commentService,
    subscriptionService,
} from "@/services";
import { unwrapList, unwrapPagination, unwrapData } from "@/utils/unwrap";
import { useAuthStore } from "@/store/authStore";

const PAGE_SIZE = 12;

/**
 * Shared cache keys. These were previously written as inline literals at each
 * call site, so a mutation invalidating ["videos","liked"] and a query
 * registered under a differently-spelled key would silently never meet.
 * Exported so pages and other feature hooks invalidate exactly what they read.
 */
export const LIKED_KEY = ["videos", "liked"];
export const COMMENTED_KEY = ["videos", "commented"];
export const SUBSCRIPTION_FEED_KEY = ["subscriptions", "feed"];

/**
 * Some rows need a session: /users/history and /likes/videos are verifyJWT-only.
 * Firing them as a guest returned 401s, which also tripped the apiClient's
 * refresh-token retry. Reading the store directly (rather than useAuth) keeps
 * these hooks usable outside the AuthProvider-consuming tree.
 */
const useIsAuthed = () => !!useAuthStore((s) => s.user);

/* ---------------- Single-page hooks ---------------- */

export function useLatestVideos({ limit = PAGE_SIZE } = {}) {
    return useQuery({
        queryKey: ["videos", "latest", limit],
        queryFn: async () => unwrapList(await videoService.latest({ limit, page: 1 })),
    });
}

export function useTrendingVideos({ limit = PAGE_SIZE } = {}) {
    return useQuery({
        queryKey: ["videos", "trending", limit],
        queryFn: async () => unwrapList(await videoService.trending({ limit, page: 1 })),
    });
}

export function useRecommendedVideos({ limit = PAGE_SIZE } = {}) {
    return useQuery({
        queryKey: ["videos", "recommended", limit],
        queryFn: async () => unwrapList(await videoService.recommended({ limit, page: 1 })),
    });
}

export function useRecentUploads({ limit = PAGE_SIZE } = {}) {
    return useQuery({
        queryKey: ["videos", "recent", limit],
        queryFn: async () =>
            unwrapList(
                await videoService.list({ sortBy: "createdAt", sortType: "desc", limit, page: 1 })
            ),
    });
}

/**
 * GET /likes/videos now returns a flat array of video documents (each with
 * `likedAt`, `isLiked: true` and the usual counts), so unwrapList gives usable
 * video objects directly. It previously returned Like documents wrapping a
 * `video` field, which meant every card here was fed a Like — `_id` was the
 * like's id and title/thumbnail/owner were all undefined.
 */
export function useLikedVideos() {
    const authed = useIsAuthed();
    return useQuery({
        queryKey: LIKED_KEY,
        queryFn: async () => unwrapList(await likeService.likedVideos()),
        enabled: authed, // /likes/videos requires a session
    });
}

/**
 * Videos the current user has commented on — the Library page.
 * Derived server-side from the comments collection, so a video appears once
 * however many times it was commented on, and disappears when the user's last
 * comment on it is deleted.
 */
export function useCommentedVideos() {
    const authed = useIsAuthed();
    return useQuery({
        queryKey: COMMENTED_KEY,
        queryFn: async () => unwrapList(await commentService.commentedVideos()),
        enabled: authed, // /comments/user/videos requires a session
    });
}

export function useContinueWatching() {
    const authed = useIsAuthed();
    return useQuery({
        queryKey: ["videos", "continue-watching"],
        queryFn: async () => unwrapList(await historyService.list()),
        enabled: authed, // never attempt watch history as a guest
    });
}

/* ---------------- Watch history (full) ---------------- */

export function useWatchHistory() {
    const authed = useIsAuthed();
    return useQuery({
        queryKey: ["watch-history"],
        queryFn: async () => unwrapList(await historyService.list()),
        enabled: authed, // never attempt watch history as a guest
    });
}

export function useRemoveFromHistory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (videoId) => historyService.remove(videoId),
        onMutate: async (videoId) => {
            await qc.cancelQueries({ queryKey: ["watch-history"] });
            await qc.cancelQueries({ queryKey: ["videos", "continue-watching"] });
            const prevHistory = qc.getQueryData(["watch-history"]);
            const prevContinue = qc.getQueryData(["videos", "continue-watching"]);
            if (Array.isArray(prevHistory)) {
                qc.setQueryData(
                    ["watch-history"],
                    prevHistory.filter((v) => (v?._id || v?.videoId) !== videoId)
                );
            }
            if (Array.isArray(prevContinue)) {
                qc.setQueryData(
                    ["videos", "continue-watching"],
                    prevContinue.filter((v) => (v?._id || v?.videoId) !== videoId)
                );
            }
            return { prevHistory, prevContinue };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prevHistory) qc.setQueryData(["watch-history"], ctx.prevHistory);
            if (ctx?.prevContinue)
                qc.setQueryData(["videos", "continue-watching"], ctx.prevContinue);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["watch-history"] });
            qc.invalidateQueries({ queryKey: ["videos", "continue-watching"] });
        },
    });
}

export function useClearHistory() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => historyService.clear(),
        onMutate: async () => {
            await qc.cancelQueries({ queryKey: ["watch-history"] });
            const prev = qc.getQueryData(["watch-history"]);
            qc.setQueryData(["watch-history"], []);
            qc.setQueryData(["videos", "continue-watching"], []);
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(["watch-history"], ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["watch-history"] });
            qc.invalidateQueries({ queryKey: ["videos", "continue-watching"] });
        },
    });
}

/**
 * "Because you liked…" row on the home page.
 *
 * This reads `liked[0].owner`, which only became a real value once /likes/videos
 * started returning video documents. While that endpoint returned Like documents
 * the owner was always undefined, so this hook silently fell through to the
 * generic most-viewed fallback every single time. No change was needed here — it
 * simply works now.
 */
export function useBasedOnLikes({ limit = PAGE_SIZE } = {}) {
    const authed = useIsAuthed();
    return useQuery({
        queryKey: ["videos", "based-on-likes", limit],
        enabled: authed, // reads /likes/videos first, which requires a session
        queryFn: async () => {
            const liked = unwrapList(await likeService.likedVideos());
            if (!liked.length) {
                return unwrapList(
                    await videoService.list({ sortBy: "views", sortType: "desc", limit })
                );
            }
            const ownerId = liked[0]?.owner?._id || liked[0]?.owner;
            if (!ownerId) {
                return unwrapList(
                    await videoService.list({ sortBy: "views", sortType: "desc", limit })
                );
            }
            const r = await videoService.list({ userId: ownerId, limit, page: 1 });
            return unwrapList(r);
        },
    });
}

/* ---------------- Infinite scroll ---------------- */

export function useInfiniteVideos(params = {}) {
    const { sortBy = "createdAt", sortType = "desc", query, userId, pageSize = PAGE_SIZE } = params;

    return useInfiniteQuery({
        queryKey: ["videos", "infinite", { sortBy, sortType, query, userId, pageSize }],
        initialPageParam: 1,
        queryFn: async ({ pageParam = 1 }) => {
            const r = await videoService.list({
                sortBy,
                sortType,
                page: pageParam,
                limit: pageSize,
                ...(query ? { query } : {}),
                ...(userId ? { userId } : {}),
            });
            return unwrapPagination(r);
        },
        getNextPageParam: (last) => (last?.hasNextPage ? last.page + 1 : undefined),
    });
}

/* ---------------- Single video ---------------- */

export function useVideo(id) {
    return useQuery({
        queryKey: ["video", id],
        queryFn: async () => unwrapData(await videoService.byId(id)),
        enabled: !!id,
    });
}

/* ---------------- Like a video (optimistic) ---------------- */

/**
 * Like/unlike a video.
 *
 * Optimistic on the watch page for instant feedback, then reconciled against the
 * server's authoritative `{ isLiked, likesCount }` (which the endpoint now
 * returns — it used to return `{}`, leaving the client's guess unverifiable).
 * A failure rolls the cache back to the pre-click snapshot.
 *
 * The Liked Videos list is also patched immediately: the just-liked video is
 * prepended, or the just-unliked one removed, so navigating to /liked right after
 * clicking shows the correct list without waiting for a refetch. The list is then
 * invalidated so MongoDB remains the source of truth.
 */
export function useToggleVideoLike(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => unwrapData(await likeService.toggleVideo(videoId)),
        onMutate: async () => {
            await qc.cancelQueries({ queryKey: ["video", videoId] });
            await qc.cancelQueries({ queryKey: LIKED_KEY });

            const prev = qc.getQueryData(["video", videoId]);
            const prevLiked = qc.getQueryData(LIKED_KEY);

            if (prev) {
                const nowLiked = !prev.isLiked;
                const delta = nowLiked ? 1 : -1;
                const nextVideo = {
                    ...prev,
                    isLiked: nowLiked,
                    likesCount: Math.max(0, (prev.likesCount ?? 0) + delta),
                };
                qc.setQueryData(["video", videoId], nextVideo);

                // Keep the Liked Videos list consistent in the same tick.
                if (Array.isArray(prevLiked)) {
                    qc.setQueryData(
                        LIKED_KEY,
                        nowLiked
                            ? [
                                  { ...nextVideo, likedAt: new Date().toISOString() },
                                  ...prevLiked.filter((v) => v?._id !== videoId),
                              ]
                            : prevLiked.filter((v) => v?._id !== videoId)
                    );
                }
            }

            return { prev, prevLiked };
        },
        onSuccess: (result) => {
            // Reconcile with the server's real numbers rather than the guess.
            if (result && typeof result.isLiked === "boolean") {
                const current = qc.getQueryData(["video", videoId]);
                if (current) {
                    qc.setQueryData(["video", videoId], {
                        ...current,
                        isLiked: result.isLiked,
                        likesCount: result.likesCount ?? current.likesCount,
                    });
                }
            }
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(["video", videoId], ctx.prev);
            if (ctx?.prevLiked) qc.setQueryData(LIKED_KEY, ctx.prevLiked);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["video", videoId] });
            qc.invalidateQueries({ queryKey: LIKED_KEY });
        },
    });
}

/**
 * Videos from the channels the current user subscribes to — the Subscriptions
 * feed. Paginated with the same envelope as GET /videos, so it plugs straight
 * into the existing InfiniteVideoGrid.
 */
export function useSubscriptionFeed({ pageSize = PAGE_SIZE } = {}) {
    const authed = useIsAuthed();
    return useInfiniteQuery({
        queryKey: [...SUBSCRIPTION_FEED_KEY, pageSize],
        enabled: authed, // /subscriptions/feed requires a session
        initialPageParam: 1,
        queryFn: async ({ pageParam = 1 }) =>
            unwrapPagination(
                await subscriptionService.feed({ page: pageParam, limit: pageSize })
            ),
        getNextPageParam: (last) => (last?.hasNextPage ? last.page + 1 : undefined),
    });
}

/**
 * The channels the current user subscribes to, for the rail at the top of the
 * Subscriptions page. Requires the user's own id because the existing endpoint is
 * GET /subscriptions/u/:subscriberId.
 */
export function useSubscribedChannels() {
    const userId = useAuthStore((s) => s.user?._id);
    return useQuery({
        queryKey: ["subscriptions", "channels", userId],
        enabled: !!userId,
        queryFn: async () =>
            unwrapList(await subscriptionService.subscribedChannels(userId)),
    });
}