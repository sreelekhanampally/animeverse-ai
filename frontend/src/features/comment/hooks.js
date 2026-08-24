import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import { commentService, likeService } from "@/services";
import { unwrapPagination, unwrapList } from "@/utils/unwrap";
// Imported rather than re-declared so the Library query and the mutations that
// must refresh it can never drift onto two differently-spelled keys.
import { COMMENTED_KEY } from "@/features/video/hooks";

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

/**
 * Post a comment (or a reply).
 *
 * Besides refreshing the thread, this now invalidates the Library / Commented
 * Videos list. That list is derived from the comments collection, so a new comment
 * can add a video to it — without this invalidation the Library kept serving its
 * cached array and the video only showed up after a full browser reload, which is
 * exactly the reported symptom.
 *
 * The video's own cache entry is invalidated too, so `commentsCount` on the watch
 * page reflects the new total.
 */
export function useAddComment(videoId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ content, parentId }) => commentService.add(videoId, content, parentId),
        onSuccess: (r, vars) => {
            if (vars.parentId) {
                qc.invalidateQueries({ queryKey: REPLIES_KEY(vars.parentId) });
            }
            qc.invalidateQueries({ queryKey: COMMENTS_KEY(videoId) });
            qc.invalidateQueries({ queryKey: COMMENTED_KEY });
            qc.invalidateQueries({ queryKey: ["video", videoId] });
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
            // Deleting the user's LAST comment on a video removes that video from
            // the Library (the list is derived from the comments collection), so
            // the Library has to be re-read. Deleting one of several comments
            // leaves the video in place — the server decides which, not the client.
            qc.invalidateQueries({ queryKey: COMMENTED_KEY });
            qc.invalidateQueries({ queryKey: ["video", videoId] });
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
