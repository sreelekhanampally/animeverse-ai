import { useQuery } from "@tanstack/react-query";
import { statsService } from "@/services";
import { unwrapData } from "@/utils/unwrap";

export const PLATFORM_STATS_KEY = ["stats", "platform"];

/**
 * Platform-wide counters for the hero, computed server-side by GET /stats:
 * { videosCount, creatorsCount }
 *
 * No `enabled` gate — the endpoint is public, so this works for guests too.
 * A longer staleTime than the global 30s default is deliberate: these totals
 * move slowly and the hero is on the most-visited route, so there is no reason
 * to re-hit the aggregation on every remount.
 */
export function usePlatformStats() {
    return useQuery({
        queryKey: PLATFORM_STATS_KEY,
        queryFn: async () => unwrapData(await statsService.platform()),
        staleTime: 5 * 60_000,
    });
}
