import { apiClient } from "./apiClient";

export const authService = {
    register: (formData) =>
        apiClient.post("/users/register", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        }),
    login: (payload) => apiClient.post("/users/login", payload),
    logout: () => apiClient.post("/users/logout"),
    me: () => apiClient.get("/users/current-user"),
    refresh: () => apiClient.post("/users/refresh-token"),
    updateAccount: (payload) => apiClient.patch("/users/update-account", payload),
    changePassword: (payload) => apiClient.post("/users/change-password", payload),
    forgotPassword: (payload) => apiClient.post("/users/forgot-password", payload),
    resetPassword: (payload) => apiClient.post("/users/reset-password", payload),
    channel: (username) => apiClient.get(`/users/c/${username}`),
    history: () => apiClient.get("/users/history"),

    /**
     * Image updates reuse the routes that already existed and already talk to
     * Cloudinary (PATCH /users/update-avatar, PATCH /users/update-coverImage).
     * The field names must stay "avatar"/"coverImage" — the backend reads them
     * with upload.single(<name>).
     *
     * Content-Type is left to the browser on purpose: it has to append the
     * multipart boundary itself, and apiClient already lengthens the timeout for
     * any FormData body.
     */
    updateAvatar: (formData) => apiClient.patch("/users/update-avatar", formData),
    updateCoverImage: (formData) =>
        apiClient.patch("/users/update-coverImage", formData),

    /* Notification preferences + the derived feed behind the navbar bell. */
    notificationPreferences: () => apiClient.get("/users/notification-preferences"),
    updateNotificationPreferences: (payload) =>
        apiClient.patch("/users/notification-preferences", payload),
    notifications: (params) => apiClient.get("/users/notifications", { params }),
    markNotificationsRead: () => apiClient.post("/users/notifications/read"),
};
