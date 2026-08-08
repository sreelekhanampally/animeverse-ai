import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { authService, subscriptionService } from "@/services";
import { unwrapData } from "@/utils/unwrap";

export const CHANNEL_KEY = (username) => ["channel", username];

/**
 * GET /users/c/:username — already existed; authService.channel() already wrapped it.
 * Returns { _id, fullName, username, avatar, coverImage, subscribersCount,
 *           channelsSubscribedToCount, isSubscribed, createdAt }.
 * The route uses optionalJWT, so guests get the channel with isSubscribed: false.
 */
export function useChannel(username) {
    return useQuery({
        queryKey: CHANNEL_KEY(username),
        enabled: !!username,
        queryFn: async () => unwrapData(await authService.channel(username)),
        retry: false, // a 404 "Channel does not exist" should surface immediately
    });
}

/**
 * Subscribe/unsubscribe on a channel page.
 *
 * The shared useToggleSubscribe in features/subscription/hooks.js patches a
 * *video* cache entry (`{ owner: { isSubscribed } }`), which is the wrong shape
 * here — a channel payload holds isSubscribed at the top level. This hook reuses
 * the same endpoint via subscriptionService.toggle (no new subscription logic,
 * no duplicated request) and only differs in which cache entry it patches.
 */
export function useToggleChannelSubscribe(username, channelId) {
    const qc = useQueryClient();
    const key = CHANNEL_KEY(username);

    return useMutation({
        mutationFn: () => subscriptionService.toggle(channelId),
        onMutate: async () => {
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData(key);
            if (prev) {
                const nowSubscribed = !prev.isSubscribed;
                qc.setQueryData(key, {
                    ...prev,
                    isSubscribed: nowSubscribed,
                    subscribersCount: Math.max(
                        0,
                        (prev.subscribersCount ?? 0) + (nowSubscribed ? 1 : -1)
                    ),
                });
            }
            return { prev };
        },
        onError: (_e, _v, ctx) => {
            // Roll back so the button never lies about the real state.
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: key });
            // The sidebar/subscriptions list reads from this key elsewhere.
            qc.invalidateQueries({ queryKey: ["subscriptions"] });
        },
    });
}
