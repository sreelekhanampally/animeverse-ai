import { apiClient } from "./apiClient";

export { apiClient, extractErrorMessage, onUnauthorized } from "./apiClient";
export { authService } from "./authService";
export { videoService } from "./videoService";

/* Additional resource services — thin wrappers around the backend API */

export const commentService = {
    list: (videoId, params) => apiClient.get(`/comments/${videoId}`, { params }),
    add: (videoId, content, parentId) =>
        apiClient.post(`/comments/${videoId}`, parentId ? { content, parentId } : { content }),
    update: (commentId, content) => apiClient.patch(`/comments/c/${commentId}`, { content }),
    remove: (commentId) => apiClient.delete(`/comments/c/${commentId}`),
    replies: (commentId, params) => apiClient.get(`/comments/c/${commentId}/replies`, { params }),
    /**
     * Videos the current user has commented on — backs the Library page.
     * GET /comments/user/videos -> { data: [ <video>, ... ] }, each video also
     * carrying myCommentsCount and lastCommentedAt.
     */
    commentedVideos: () => apiClient.get("/comments/user/videos"),
};

export const likeService = {
    toggleVideo: (videoId) => apiClient.post(`/likes/toggle/v/${videoId}`),
    toggleComment: (commentId) => apiClient.post(`/likes/toggle/c/${commentId}`),
    toggleTweet: (tweetId) => apiClient.post(`/likes/toggle/t/${tweetId}`),
    likedVideos: () => apiClient.get("/likes/videos"),
};

export const subscriptionService = {
    toggle: (channelId) => apiClient.post(`/subscriptions/c/${channelId}`),
    subscribers: (channelId) => apiClient.get(`/subscriptions/c/${channelId}`),
    subscribedChannels: (userId) => apiClient.get(`/subscriptions/u/${userId}`),
    /**
     * Videos from every channel the current user subscribes to — backs the
     * Subscriptions page. Paginated with the same envelope as GET /videos.
     */
    feed: (params) => apiClient.get("/subscriptions/feed", { params }),
};

export const playlistService = {
    create: (payload) => apiClient.post("/playlist", payload),
    byId: (id) => apiClient.get(`/playlist/${id}`),
    userPlaylists: (userId) => apiClient.get(`/playlist/user/${userId}`),
    addVideo: (playlistId, videoId) => apiClient.patch(`/playlist/add/${playlistId}/${videoId}`),
    removeVideo: (playlistId, videoId) => apiClient.patch(`/playlist/remove/${playlistId}/${videoId}`),
    update: (id, payload) => apiClient.patch(`/playlist/${id}`, payload),
    remove: (id) => apiClient.delete(`/playlist/${id}`),
};

export const historyService = {
    list: () => apiClient.get("/users/history"),
    /**
     * The backend records watch history when a video is fetched by id.
     * These aliases exist so the frontend can call them intentionally
     * without adding new endpoints.
     */
    track: (videoId) => apiClient.get(`/videos/${videoId}`),
    remove: (videoId) => apiClient.delete(`/users/history/${videoId}`).catch(() => null),
    clear: () => apiClient.delete(`/users/history`).catch(() => null),
};

export const tweetService = {
    list: (params) => apiClient.get("/tweets", { params }),
    userTweets: (userId) => apiClient.get(`/tweets/user/${userId}`),
    create: (payload) => apiClient.post("/tweets", payload),
    update: (id, payload) => apiClient.patch(`/tweets/${id}`, payload),
    remove: (id) => apiClient.delete(`/tweets/${id}`),
};

export const dashboardService = {
    stats: () => apiClient.get("/dashboard/stats"),
    videos: () => apiClient.get("/dashboard/videos"),
};

/**
 * Platform-wide counters for the homepage hero — public, unlike
 * dashboardService.stats() which is the logged-in creator's own totals.
 */
export const statsService = {
    platform: () => apiClient.get("/stats"),
};

/* AI service — scaffolded for future sessions, not called in this session. */
export const aiService = {
    health: () => apiClient.get("/ai/health"),
    search: (q, limit = 20) => apiClient.get("/ai/search", { params: { q, limit } }),
    chat: (messages) => apiClient.post("/ai/chat", { messages }),
    recommendations: (limit = 12) => apiClient.get("/ai/recommendations", { params: { limit } }),
};