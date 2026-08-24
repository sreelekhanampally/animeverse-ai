import { useMutation, useQueryClient } from "@tanstack/react-query";
import { subscriptionService } from "@/services";
import { unwrapData } from "@/utils/unwrap";
import { SUBSCRIPTION_FEED_KEY } from "@/features/video/hooks";

/**
 * Subscribe/unsubscribe from anywhere that renders a video's creator (the watch
 * page's CreatorCard, primarily).
 *
 * Three things were wrong before:
 *
 * 1. The optimistic patch wrote `owner.isSubscribed` into the video cache, but the
 *    backend never sent that field, so the invalidation in onSettled refetched a
 *    payload where it was `undefined`. The button flipped to "Subscribed" and then
 *    immediately reverted. getVideoById/getAllVideos now return it, and this hook
 *    reconciles against the server's own `{ isSubscribed, subscribersCount }`
 *    rather than a locally-incremented guess.
 *
 * 2. Nothing outside the single patched video cache was refreshed, so the channel
 *    page, the subscriptions rail and the feed all kept stale state until a hard
 *    reload. All of those keys are invalidated now.
 *
 * 3. The subscription feed did not exist, so a new subscription could not surface
 *    the creator's videos. It is invalidated here so it repopulates.
 *
 * MongoDB stays the source of truth throughout: the optimistic write exists only
 * to make the click feel instant, and it is rolled back on failure.
 */
export function useToggleSubscribe(channelId, videoQueryKey) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => unwrapData(await subscriptionService.toggle(channelId)),
        onMutate: async () => {
            if (!videoQueryKey) return {};
            await qc.cancelQueries({ queryKey: videoQueryKey });
            const prev = qc.getQueryData(videoQueryKey);
            if (prev?.owner) {
                const nowSub = !prev.owner.isSubscribed;
                const delta = nowSub ? 1 : -1;
                qc.setQueryData(videoQueryKey, {
                    ...prev,
                    owner: {
                        ...prev.owner,
                        isSubscribed: nowSub,
                        subscribersCount: Math.max(
                            0,
                            (prev.owner.subscribersCount ?? 0) + delta
                        ),
                    },
                });
            }
            return { prev };
        },
        onSuccess: (result) => {
            // Replace the guess with the server's authoritative numbers.
            if (videoQueryKey && result && typeof result.isSubscribed === "boolean") {
                const current = qc.getQueryData(videoQueryKey);
                if (current?.owner) {
                    qc.setQueryData(videoQueryKey, {
                        ...current,
                        owner: {
                            ...current.owner,
                            isSubscribed: result.isSubscribed,
                            subscribersCount:
                                result.subscribersCount ?? current.owner.subscribersCount,
                        },
                    });
                }
            }
        },
        onError: (_e, _v, ctx) => {
            if (videoQueryKey && ctx?.prev) qc.setQueryData(videoQueryKey, ctx.prev);
        },
        onSettled: () => {
            if (videoQueryKey) qc.invalidateQueries({ queryKey: videoQueryKey });
            // Everywhere else that renders subscription state.
            qc.invalidateQueries({ queryKey: ["channel"] });
            qc.invalidateQueries({ queryKey: ["subscriptions"] });
            qc.invalidateQueries({ queryKey: SUBSCRIPTION_FEED_KEY });
            // Listings embed owner.isSubscribed too, so their cards agree.
            qc.invalidateQueries({ queryKey: ["videos"] });
        },
    });
}
