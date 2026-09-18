import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { communityService } from "@/services";
import { unwrapData, unwrapList } from "@/utils/unwrap";
import { useAuth } from "@/contexts/AuthContext";

const FEED_KEY = ["community", "posts"];
const postKey = (postId, viewerId = "guest") => ["community", "post", postId, viewerId];
const commentsKey = (postId) => ["community", "comments", postId];

export function useCommunityFeed({ limit = 6, type } = {}) {
    const { user } = useAuth();
    const viewerId = user?._id || "guest";
    return useQuery({
        queryKey: ["community", "posts", limit, type || "all", viewerId],
        queryFn: async () =>
            unwrapList(await communityService.posts({ limit, page: 1, ...(type ? { type } : {}) })),
    });
}

export function useCommunityPost(postId) {
    const { user } = useAuth();
    const viewerId = user?._id || "guest";
    return useQuery({
        queryKey: postKey(postId, viewerId),
        enabled: !!postId,
        queryFn: async () => unwrapData(await communityService.post(postId)),
    });
}

export function useCommunityComments(postId) {
    return useQuery({
        queryKey: commentsKey(postId),
        enabled: !!postId,
        queryFn: async () => unwrapList(await communityService.comments(postId)),
    });
}

export function useCreateCommunityPost() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload) => unwrapData(await communityService.createPost(payload)),
        onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
    });
}

export function useUpvoteCommunityPost() {
    const qc = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?._id || "guest";
    return useMutation({
        mutationFn: async (postId) => ({
            postId,
            data: unwrapData(await communityService.upvote(postId)),
        }),
        onSuccess: ({ postId, data }) => {
            const patch = (post) =>
                post?._id === postId
                    ? {
                          ...post,
                          upvoteCount: data?.upvoteCount ?? post.upvoteCount,
                          hasUpvoted: data?.hasUpvoted ?? post.hasUpvoted,
                      }
                    : post;

            qc.setQueriesData({ queryKey: FEED_KEY }, (old) =>
                Array.isArray(old) ? old.map(patch) : old
            );
            qc.setQueryData(postKey(postId, viewerId), (old) => patch(old));
        },
        onSettled: (_data, _error, postId) => {
            qc.invalidateQueries({ queryKey: FEED_KEY });
            qc.invalidateQueries({ queryKey: ["community", "post", postId] });
        },
    });
}

export function useVoteCommunityPost() {
    const qc = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?._id || "guest";
    return useMutation({
        mutationFn: async ({ postId, optionIndex }) => ({
            postId,
            data: unwrapData(await communityService.vote(postId, optionIndex)),
        }),
        onSuccess: ({ postId, data }) => {
            const patch = (post) =>
                post?._id === postId
                    ? {
                          ...post,
                          pollOptions: data?.pollOptions ?? post.pollOptions,
                          selectedPollOption:
                              data?.selectedPollOption ?? post.selectedPollOption,
                      }
                    : post;

            qc.setQueriesData({ queryKey: FEED_KEY }, (old) =>
                Array.isArray(old) ? old.map(patch) : old
            );
            qc.setQueryData(postKey(postId, viewerId), (old) => patch(old));
        },
        onSettled: (_data, _error, variables) => {
            qc.invalidateQueries({ queryKey: FEED_KEY });
            if (variables?.postId) {
                qc.invalidateQueries({ queryKey: ["community", "post", variables.postId] });
            }
        },
    });
}

export function useAddCommunityComment(postId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ content, parentId }) =>
            unwrapData(
                await communityService.addComment(postId, {
                    content,
                    ...(parentId ? { parentId } : {}),
                })
            ),
        onSuccess: (comment) => {
            qc.setQueryData(commentsKey(postId), (old = []) =>
                Array.isArray(old) ? [...old, comment] : [comment]
            );
            qc.invalidateQueries({ queryKey: ["community", "post", postId] });
            qc.invalidateQueries({ queryKey: FEED_KEY });
        },
    });
}

export function useDeleteCommunityComment(postId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (commentId) => {
            await communityService.removeComment(postId, commentId);
            return commentId;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: commentsKey(postId) });
            qc.invalidateQueries({ queryKey: ["community", "post", postId] });
            qc.invalidateQueries({ queryKey: FEED_KEY });
        },
    });
}
