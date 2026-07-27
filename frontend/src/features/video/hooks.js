import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { videoService, likeService, historyService } from "@/services";
import { unwrapList, unwrapPagination, unwrapData } from "@/utils/unwrap";

const PAGE_SIZE = 12;

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
    return useQuery({
        queryKey: ["videos", "liked"],
        queryFn: async () => unwrapList(await likeService.likedVideos()),
    });
}

export function useContinueWatching() {
    return useQuery({
        queryKey: ["videos", "continue-watching"],
        queryFn: async () => unwrapList(await historyService.list()),
    });
}

export function useBasedOnLikes({ limit = PAGE_SIZE } = {}) {
    return useQuery({
        queryKey: ["videos", "based-on-likes", limit],
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