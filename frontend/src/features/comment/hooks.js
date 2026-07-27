import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { commentService, likeService } from "@/services";
import { unwrapPagination, unwrapList } from "@/utils/unwrap";

const COMMENTS_KEY = (videoId) => ["comments", videoId];
const REPLIES_KEY = (commentId) => ["comment-replies", commentId];

export function useComments(videoId, { pageSize = 10 } = {}) {
    return useInfiniteQuery({
        queryKey: [...COMMENTS_KEY(videoId), pageSize],
        enabled: !!videoId,
        initialPageParam: 1,
        queryFn: async ({ pageParam = 1 }) =>
            unwrapPagination(await commentService.list(videoId, { page: pageParam, limit: pageSize })),
        getNextPageParam: (last) => (last?.hasNextPage ? last.page + 1 : undefined),
    });
}

export function useCommentReplies(commentId, enabled) {
    return useQuery({
        queryKey: REPLIES_KEY(commentId),
        enabled: !!commentId && enabled,
        queryFn: async () => unwrapList(await commentService.replies(commentId)),
    });
}

export function useAddComment(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ content, parentId }) => commentService.add(videoId, content, parentId),
        onSuccess: (r, vars) => {
            if (vars.parentId) {
                qc.invalidateQueries({ queryKey: REPLIES_KEY(vars.parentId) });
            }
            qc.invalidateQueries({ queryKey: COMMENTS_KEY(videoId) });
        },
    });
}

export function useUpdateComment(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ commentId, content }) => commentService.update(commentId, content),
        onMutate: async ({ commentId, content }) => {
            await qc.cancelQueries({ queryKey: COMMENTS_KEY(videoId) });
            const prev = qc.getQueriesData({ queryKey: COMMENTS_KEY(videoId) });
            prev.forEach(([key, data]) => {
                if (!data?.pages) return;
                qc.setQueryData(key, {
                    ...data,
                    pages: data.pages.map((p) => ({
                        ...p,
                        items: p.items.map((c) =>
                            c._id === commentId ? { ...c, content, edited: true } : c
                        ),
                    })),
                });
            });
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: COMMENTS_KEY(videoId) });
        },
    });
}

export function useDeleteComment(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ commentId }) => commentService.remove(commentId),
        onMutate: async ({ commentId }) => {
            await qc.cancelQueries({ queryKey: COMMENTS_KEY(videoId) });
            const prev = qc.getQueriesData({ queryKey: COMMENTS_KEY(videoId) });
            prev.forEach(([key, data]) => {
                if (!data?.pages) return;
                qc.setQueryData(key, {
                    ...data,
                    pages: data.pages.map((p) => ({
                        ...p,
                        items: p.items.filter((c) => c._id !== commentId),
                    })),
                });
            });
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: COMMENTS_KEY(videoId) });
        },
    });
}

export function useToggleCommentLike(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (commentId) => likeService.toggleComment(commentId),
        onMutate: async (commentId) => {
            await qc.cancelQueries({ queryKey: COMMENTS_KEY(videoId) });
            const prev = qc.getQueriesData({ queryKey: COMMENTS_KEY(videoId) });
            prev.forEach(([key, data]) => {
                if (!data?.pages) return;
                qc.setQueryData(key, {
                    ...data,
                    pages: data.pages.map((p) => ({
                        ...p,
                        items: p.items.map((c) => {
                            if (c._id !== commentId) return c;
                            const nowLiked = !c.isLiked;
                            const delta = nowLiked ? 1 : -1;
                            return {
                                ...c,
                                isLiked: nowLiked,
                                likesCount: Math.max(0, (c.likesCount ?? 0) + delta),
                            };
                        }),
                    })),
                });
            });
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            ctx?.prev?.forEach(([key, data]) => qc.setQueryData(key, data));
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: COMMENTS_KEY(videoId) });
        },
    });
}
