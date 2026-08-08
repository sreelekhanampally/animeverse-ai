import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardService, videoService } from "@/services";
import { unwrapData, unwrapList } from "@/utils/unwrap";

export const DASHBOARD_STATS_KEY = ["dashboard", "stats"];
export const DASHBOARD_VIDEOS_KEY = ["dashboard", "videos"];

/**
 * Creator stats, computed server-side by GET /dashboard/stats:
 * { totalVideos, totalViews, totalLikes, totalSubscribers }
 */
export function useDashboardStats() {
    return useQuery({
        queryKey: DASHBOARD_STATS_KEY,
        queryFn: async () => unwrapData(await dashboardService.stats()),
    });
}

/** The logged-in creator's own videos (GET /dashboard/videos, newest first). */
export function useMyVideos() {
    return useQuery({
        queryKey: DASHBOARD_VIDEOS_KEY,
        queryFn: async () => unwrapList(await dashboardService.videos()),
    });
}

/**
 * Invalidates every list that can show the affected video, plus the stats
 * card totals. Kept in one place so all three mutations stay consistent.
 */
function useInvalidateVideoViews() {
    const qc = useQueryClient();
    return (videoId) => {
        qc.invalidateQueries({ queryKey: DASHBOARD_VIDEOS_KEY });
        qc.invalidateQueries({ queryKey: DASHBOARD_STATS_KEY });
        qc.invalidateQueries({ queryKey: ["videos"] });
        if (videoId) qc.invalidateQueries({ queryKey: ["video", videoId] });
    };
}

/** PATCH /videos/:videoId — multipart, so an optional thumbnail can ride along. */
export function useUpdateVideo() {
    const invalidate = useInvalidateVideoViews();
    return useMutation({
        mutationFn: ({ id, formData }) => videoService.update(id, formData),
        onSuccess: (_r, vars) => invalidate(vars.id),
    });
}

/** DELETE /videos/:videoId — backend also removes the Cloudinary assets. */
export function useDeleteVideo() {
    const invalidate = useInvalidateVideoViews();
    return useMutation({
        mutationFn: (id) => videoService.remove(id),
        onSuccess: (_r, id) => invalidate(id),
    });
}

/** PATCH /videos/toggle/publish/:videoId */
export function useTogglePublish() {
    const invalidate = useInvalidateVideoViews();
    return useMutation({
        mutationFn: (id) => videoService.togglePublish(id),
        onSuccess: (_r, id) => invalidate(id),
    });
}
