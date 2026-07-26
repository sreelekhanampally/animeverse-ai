import { useQuery } from "@tanstack/react-query";
import { videoService } from "@/services";

const unwrapVideos = (r) => {
    const d = r?.data?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.docs)) return d.docs;
    if (Array.isArray(d?.videos)) return d.videos;
    if (Array.isArray(d?.items)) return d.items;
    return [];
};

export function useLatestVideos({ limit = 12 } = {}) {
    return useQuery({
        queryKey: ["videos", "latest", limit],
        queryFn: async () => unwrapVideos(await videoService.latest({ limit, page: 1 })),
    });
}

export function useTrendingVideos({ limit = 12 } = {}) {
    return useQuery({
        queryKey: ["videos", "trending", limit],
        queryFn: async () => unwrapVideos(await videoService.trending({ limit, page: 1 })),
    });
}

export function useRecommendedVideos({ limit = 12 } = {}) {
    return useQuery({
        queryKey: ["videos", "recommended", limit],
        queryFn: async () => unwrapVideos(await videoService.recommended({ limit, page: 1 })),
    });
}
