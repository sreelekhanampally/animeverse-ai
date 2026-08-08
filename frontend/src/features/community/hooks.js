import { useQuery } from "@tanstack/react-query";
import { tweetService } from "@/services";
import { useAuthStore } from "@/store/authStore";

const unwrap = (r) => {
    const d = r?.data?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.docs)) return d.docs;
    if (Array.isArray(d?.tweets)) return d.tweets;
    return [];
};

export function useCommunityFeed({ limit = 6 } = {}) {
    // GET /tweets is behind verifyJWT, so as a guest this only produced a 401
    // (and a wasted refresh-token retry). Gate it instead of widening that
    // route's auth, which is outside the scope of this fix.
    const authed = !!useAuthStore((s) => s.user);
    return useQuery({
        queryKey: ["tweets", "feed", limit],
        queryFn: async () => unwrap(await tweetService.list({ limit, page: 1 })),
        enabled: authed,
    });
}
