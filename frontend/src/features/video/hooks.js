import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { videoService, likeService, historyService } from "@/services";
import { unwrapList, unwrapPagination, unwrapData } from "@/utils/unwrap";
import { useAuthStore } from "@/store/authStore";

const PAGE_SIZE = 12;

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

export function useLikedVideos() {
    const authed = useIsAuthed();
    return useQuery({
        queryKey: ["videos", "liked"],
        queryFn: async () => unwrapList(await likeService.likedVideos()),
        enabled: authed, // /likes/videos requires a session
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

export function useToggleVideoLike(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => likeService.toggleVideo(videoId),
        onMutate: async () => {
            await qc.cancelQueries({ queryKey: ["video", videoId] });
            const prev = qc.getQueryData(["video", videoId]);
            if (prev) {
                const nowLiked = !prev.isLiked;
                const delta = nowLiked ? 1 : -1;
                qc.setQueryData(["video", videoId], {
                    ...prev,
                    isLiked: nowLiked,
                    likesCount: Math.max(0, (prev.likesCount ?? 0) + delta),
                });
            }
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(["video", videoId], ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ["video", videoId] });
            qc.invalidateQueries({ queryKey: ["videos", "liked"] });
        },
    });
}