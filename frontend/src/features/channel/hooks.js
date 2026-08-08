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
 * no duplicated request).
 *
 * The server is the single source of truth. There is no optimistic patching and
 * no locally-incremented counter: the toggle response now carries the real
 * { isSubscribed, subscribersCount }, which is written straight into the channel
 * cache, and the channel query is then refetched to confirm. That removes the
 * class of bug where a local counter and the button's state could drift apart.
 */
export function useToggleChannelSubscribe(username, channelId) {
    const qc = useQueryClient();
    const key = CHANNEL_KEY(username);

    return useMutation({
        mutationFn: async () => unwrapData(await subscriptionService.toggle(channelId)),
        onSuccess: (result) => {
            // Trust the server's numbers rather than guessing at them.
            const prev = qc.getQueryData(key);
            if (prev && typeof result?.isSubscribed === "boolean") {
                qc.setQueryData(key, {
                    ...prev,
                    isSubscribed: result.isSubscribed,
                    subscribersCount: result.subscribersCount ?? prev.subscribersCount,
                });
            }
        },
        onSettled: async () => {
            // Awaited (and returned) so mutateAsync only resolves once the
            // refetch has landed. The caller's ref guard therefore stays closed
            // for the whole cycle, and isSubscribed + subscribersCount both come
            // from the same authoritative GET /users/c/:username response.
            await qc.invalidateQueries({ queryKey: key });
            // The sidebar/subscriptions list reads from this key elsewhere.
            qc.invalidateQueries({ queryKey: ["subscriptions"] });
        },
    });
}
