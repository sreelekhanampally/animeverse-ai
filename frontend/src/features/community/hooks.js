import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { communityService } from "@/services";
import { unwrapData, unwrapList } from "@/utils/unwrap";


export function useCommunityFeed({ limit = 6, type } = {}) {
    return useQuery({
        queryKey: ["community", "posts", limit, type || "all"],
        queryFn: async () => unwrapList(await communityService.posts({ limit, page: 1, ...(type ? { type } : {}) })),
    });
}

export function useCreateCommunityPost() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload) => unwrapData(await communityService.createPost(payload)),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["community", "posts"] }),
    });
}

export function useUpvoteCommunityPost() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (postId) => unwrapData(await communityService.upvote(postId)),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["community", "posts"] }),
    });
}

export function useVoteCommunityPost() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ postId, optionIndex }) =>
            unwrapData(await communityService.vote(postId, optionIndex)),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["community", "posts"] }),
    });
}
