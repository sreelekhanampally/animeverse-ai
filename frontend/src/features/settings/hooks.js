import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authService } from "@/services";
import { unwrapData } from "@/utils/unwrap";
import { useAuth } from "@/contexts/AuthContext";

export const NOTIFICATION_PREFERENCES_KEY = ["notifications", "preferences"];
export const NOTIFICATIONS_KEY = ["notifications", "feed"];

/**
 * Every mutation here changes the identity the whole app renders, so each one has
 * to reach three places, not just the Settings page:
 *
 *   1. the auth store, which Navbar/Sidebar read directly for avatar + name,
 *   2. the ["channel", username] cache, which the channel page reads,
 *   3. any cached video/comment list carrying an embedded owner object.
 *
 * Without (2) and (3) the Settings card updates while the rest of the UI keeps
 * showing the old name until a hard reload.
 */
function useSyncIdentity() {
    const qc = useQueryClient();
    const { setUser, user } = useAuth();

    return (updatedUser) => {
        const previousUsername = user?.username;

        // The PATCH responses already return the full sanitised user document
        // (no password, no refreshToken), so there is nothing to re-fetch.
        if (updatedUser) setUser(updatedUser);

        // A renamed channel lives under a different key; drop the old one so a
        // stale entry can't be served if the user navigates back to it.
        if (previousUsername && previousUsername !== updatedUser?.username) {
            qc.removeQueries({ queryKey: ["channel", previousUsername] });
        }
        if (updatedUser?.username) {
            qc.invalidateQueries({ queryKey: ["channel", updatedUser.username] });
        }

        // Lists embed { owner: { username, fullName, avatar } }.
        qc.invalidateQueries({ queryKey: ["videos"] });
        qc.invalidateQueries({ queryKey: ["video"] });
        qc.invalidateQueries({ queryKey: ["comments"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
    };
}

/**
 * PATCH /users/update-account — fullName, email and (optionally) username.
 *
 * Avatar and cover image go through their own pre-existing Cloudinary routes, so
 * they are sent as separate requests, sequenced after the text fields. Doing them
 * in one PATCH would mean changing the backend's multipart handling for a route
 * that already works.
 */
export function useUpdateProfile() {
    const sync = useSyncIdentity();

    return useMutation({
        mutationFn: async ({ fullName, email, username, avatar, coverImage }) => {
            let updated = unwrapData(
                await authService.updateAccount({ fullName, email, username })
            );

            // Sequential, not Promise.all: both routes write the same user
            // document, and the later response is the one that must win.
            if (avatar) {
                const fd = new FormData();
                fd.append("avatar", avatar);
                updated = unwrapData(await authService.updateAvatar(fd)) || updated;
            }
            if (coverImage) {
                const fd = new FormData();
                fd.append("coverImage", coverImage);
                updated = unwrapData(await authService.updateCoverImage(fd)) || updated;
            }
            return updated;
        },
        onSuccess: (updatedUser) => sync(updatedUser),
    });
}

/**
 * POST /users/change-password.
 *
 * The backend rotates the refresh token on success and hands back a fresh access
 * token, which is stored so the current tab stays authenticated instead of being
 * logged out by the next 401.
 */
export function useChangePassword() {
    return useMutation({
        mutationFn: async (payload) =>
            unwrapData(await authService.changePassword(payload)),
    });
}

/** GET /users/notification-preferences -> all five switches, defaulted server-side. */
export function useNotificationPreferences(enabled = true) {
    return useQuery({
        queryKey: NOTIFICATION_PREFERENCES_KEY,
        enabled,
        queryFn: async () => unwrapData(await authService.notificationPreferences()),
    });
}

/**
 * PATCH /users/notification-preferences with a single key.
 *
 * The switches save on toggle, so the optimistic write is what makes them feel
 * instant; onError rolls back to the exact snapshot rather than guessing, and the
 * feed is invalidated because a disabled category disappears from it server-side.
 */
export function useUpdateNotificationPreferences() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (patch) =>
            unwrapData(await authService.updateNotificationPreferences(patch)),
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey: NOTIFICATION_PREFERENCES_KEY });
            const previous = qc.getQueryData(NOTIFICATION_PREFERENCES_KEY);
            if (previous) {
                qc.setQueryData(NOTIFICATION_PREFERENCES_KEY, { ...previous, ...patch });
            }
            return { previous };
        },
        onError: (_err, _patch, ctx) => {
            if (ctx?.previous) {
                qc.setQueryData(NOTIFICATION_PREFERENCES_KEY, ctx.previous);
            }
        },
        onSuccess: (server) => {
            // Replace the optimistic guess with the server's authoritative object.
            if (server) qc.setQueryData(NOTIFICATION_PREFERENCES_KEY, server);
            qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        },
    });
}

/**
 * GET /users/notifications — the derived feed for the navbar bell.
 * Returns { notifications, unreadCount, lastReadAt }.
 */
export function useNotifications(enabled = true) {
    return useQuery({
        queryKey: NOTIFICATIONS_KEY,
        enabled,
        queryFn: async () => unwrapData(await authService.notifications()),
    });
}

/** POST /users/notifications/read — stamps notificationsLastReadAt. */
export function useMarkNotificationsRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => authService.markNotificationsRead(),
        onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    });
}
