import { useQuery } from "@tanstack/react-query";
import { tweetService } from "@/services";

const unwrap = (r) => {
    const d = r?.data?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.docs)) return d.docs;
    if (Array.isArray(d?.tweets)) return d.tweets;
    return [];
};

export function useCommunityFeed({ limit = 6 } = {}) {
    return useQuery({
        queryKey: ["tweets", "feed", limit],
        queryFn: async () => unwrap(await tweetService.list({ limit, page: 1 })),
    });
}
