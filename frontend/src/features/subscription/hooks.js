import { useMutation, useQueryClient } from "@tanstack/react-query";
import { subscriptionService } from "@/services";

export function useToggleSubscribe(channelId, videoQueryKey) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => subscriptionService.toggle(channelId),
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
        onError: (_e, _v, ctx) => {
            if (videoQueryKey && ctx?.prev) qc.setQueryData(videoQueryKey, ctx.prev);
        },
        onSettled: () => {
            if (videoQueryKey) qc.invalidateQueries({ queryKey: videoQueryKey });
        },
    });
}