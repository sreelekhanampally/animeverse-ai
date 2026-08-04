import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { playlistService } from "@/services";
import { unwrapData, unwrapList } from "@/utils/unwrap";
import { useAuth } from "@/contexts/AuthContext";

const USER_PLAYLISTS_KEY = (userId) => ["playlists", "user", userId];
const PLAYLIST_KEY = (id) => ["playlist", id];

export function useMyPlaylists() {
    const { user } = useAuth();
    return useQuery({
        queryKey: USER_PLAYLISTS_KEY(user?._id),
        enabled: !!user?._id,
        queryFn: async () => unwrapList(await playlistService.userPlaylists(user._id)),
    });
}

export function useUserPlaylists(userId) {
    return useQuery({
        queryKey: USER_PLAYLISTS_KEY(userId),
        enabled: !!userId,
        queryFn: async () => unwrapList(await playlistService.userPlaylists(userId)),
    });
}

export function usePlaylist(id) {
    return useQuery({
        queryKey: PLAYLIST_KEY(id),
        enabled: !!id,
        queryFn: async () => unwrapData(await playlistService.byId(id)),
    });
}

export function useCreatePlaylist() {
    const qc = useQueryClient();
    const { user } = useAuth();
    return useMutation({
        mutationFn: (payload) => playlistService.create(payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: USER_PLAYLISTS_KEY(user?._id) });
        },
    });
}

export function useUpdatePlaylist() {
    const qc = useQueryClient();
    const { user } = useAuth();
    return useMutation({
        mutationFn: ({ id, payload }) => playlistService.update(id, payload),
        onSuccess: (_r, vars) => {
            qc.invalidateQueries({ queryKey: USER_PLAYLISTS_KEY(user?._id) });
            qc.invalidateQueries({ queryKey: PLAYLIST_KEY(vars.id) });
        },
    });
}

export function useDeletePlaylist() {
    const qc = useQueryClient();
    const { user } = useAuth();
    return useMutation({
        mutationFn: (id) => playlistService.remove(id),
        onMutate: async (id) => {
            const key = USER_PLAYLISTS_KEY(user?._id);
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData(key);
            if (Array.isArray(prev)) {
                qc.setQueryData(key, prev.filter((p) => p._id !== id));
            }
            return { prev, key };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: USER_PLAYLISTS_KEY(user?._id) });
        },
    });
}

export function useAddVideoToPlaylist() {
    const qc = useQueryClient();
    const { user } = useAuth();
    return useMutation({
        mutationFn: ({ playlistId, videoId }) => playlistService.addVideo(playlistId, videoId),
        onSuccess: (_r, vars) => {
            qc.invalidateQueries({ queryKey: USER_PLAYLISTS_KEY(user?._id) });
            qc.invalidateQueries({ queryKey: PLAYLIST_KEY(vars.playlistId) });
        },
    });
}

export function useRemoveVideoFromPlaylist() {
    const qc = useQueryClient();
    const { user } = useAuth();
    return useMutation({
        mutationFn: ({ playlistId, videoId }) => playlistService.removeVideo(playlistId, videoId),
        onMutate: async ({ playlistId, videoId }) => {
            const key = PLAYLIST_KEY(playlistId);
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData(key);
            if (prev?.videos) {
                qc.setQueryData(key, {
                    ...prev,
                    videos: prev.videos.filter((v) => (v._id || v) !== videoId),
                });
            }
            return { prev, key };
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
        },
        onSettled: (_r, _e, vars) => {
            qc.invalidateQueries({ queryKey: PLAYLIST_KEY(vars.playlistId) });
            qc.invalidateQueries({ queryKey: USER_PLAYLISTS_KEY(user?._id) });
        },
    });
}