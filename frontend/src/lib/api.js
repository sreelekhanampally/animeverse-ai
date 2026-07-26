import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "/api/v1";

export const api = axios.create({
    baseURL,
    withCredentials: true,
});

// Attach access token from localStorage if present
api.interceptors.request.use((cfg) => {
    const t = localStorage.getItem("accessToken");
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
});

let refreshing = null;
api.interceptors.response.use(
    (r) => r,
    async (error) => {
        const original = error.config;
        if (error.response?.status === 401 && !original._retry) {
            original._retry = true;
            try {
                refreshing =
                    refreshing ||
                    api.post("/users/refresh-token").finally(() => {
                        refreshing = null;
                    });
                const r = await refreshing;
                const newAccess = r.data?.data?.accessToken;
                if (newAccess) localStorage.setItem("accessToken", newAccess);
                return api(original);
            } catch (e) {
                localStorage.removeItem("accessToken");
                return Promise.reject(e);
            }
        }
        return Promise.reject(error);
    }
);

// ---------------- Auth ----------------
export const authApi = {
    register: (formData) => api.post("/users/register", formData, { headers: { "Content-Type": "multipart/form-data" } }),
    login: (payload) => api.post("/users/login", payload),
    logout: () => api.post("/users/logout"),
    me: () => api.get("/users/current-user"),
    updateAccount: (payload) => api.patch("/users/update-account", payload),
    changePassword: (payload) => api.post("/users/change-password", payload),
    channel: (username) => api.get(`/users/c/${username}`),
    history: () => api.get("/users/history"),
};

// ---------------- Videos ----------------
export const videoApi = {
    list: (params) => api.get("/videos", { params }),
    byId: (id) => api.get(`/videos/${id}`),
    publish: (formData) =>
        api.post("/videos", formData, { headers: { "Content-Type": "multipart/form-data" } }),
    update: (id, formData) => api.patch(`/videos/${id}`, formData),
    remove: (id) => api.delete(`/videos/${id}`),
    togglePublish: (id) => api.patch(`/videos/toggle/publish/${id}`),
};

// ---------------- Comments ----------------
export const commentApi = {
    list: (videoId, params) => api.get(`/comments/${videoId}`, { params }),
    add: (videoId, content) => api.post(`/comments/${videoId}`, { content }),
    update: (commentId, content) => api.patch(`/comments/c/${commentId}`, { content }),
    remove: (commentId) => api.delete(`/comments/c/${commentId}`),
};

// ---------------- Likes ----------------
export const likeApi = {
    toggleVideo: (videoId) => api.post(`/likes/toggle/v/${videoId}`),
    toggleComment: (commentId) => api.post(`/likes/toggle/c/${commentId}`),
    likedVideos: () => api.get("/likes/videos"),
};

// ---------------- Subscriptions ----------------
export const subApi = {
    toggle: (channelId) => api.post(`/subscriptions/c/${channelId}`),
    subscribers: (channelId) => api.get(`/subscriptions/c/${channelId}`),
    subscribedChannels: (userId) => api.get(`/subscriptions/u/${userId}`),
};

// ---------------- Playlists ----------------
export const playlistApi = {
    create: (payload) => api.post("/playlist", payload),
    byId: (id) => api.get(`/playlist/${id}`),
    userPlaylists: (userId) => api.get(`/playlist/user/${userId}`),
    addVideo: (playlistId, videoId) => api.patch(`/playlist/add/${playlistId}/${videoId}`),
    removeVideo: (playlistId, videoId) => api.patch(`/playlist/remove/${playlistId}/${videoId}`),
    update: (id, payload) => api.patch(`/playlist/${id}`, payload),
    remove: (id) => api.delete(`/playlist/${id}`),
};

// ---------------- Dashboard ----------------
export const dashApi = {
    stats: () => api.get("/dashboard/stats"),
    videos: () => api.get("/dashboard/videos"),
};

// ---------------- AI ----------------
export const aiApi = {
    health: () => api.get("/ai/health"),
    search: (q, limit = 20) => api.get("/ai/search", { params: { q, limit } }),
    recommendations: (limit = 12) => api.get("/ai/recommendations", { params: { limit } }),
    summary: (videoId, refresh = false) =>
        api.get(`/ai/videos/${videoId}/summary`, { params: refresh ? { refresh: 1 } : {} }),
    ask: (videoId, question) => api.post(`/ai/videos/${videoId}/ask`, { question }),
    sentiment: (videoId) => api.get(`/ai/videos/${videoId}/sentiment`),
    translate: (text, target = "en") => api.post("/ai/translate", { text, target }),
    reindex: (videoId) => api.post(`/ai/videos/${videoId}/reindex`),
    transcribe: (formData) =>
        api.post("/ai/transcribe", formData, { headers: { "Content-Type": "multipart/form-data" } }),
};

// ---------------- Community ----------------
export const communityApi = {
    clubs: () => api.get("/community/clubs"),
    createClub: (payload) => api.post("/community/clubs", payload),
    join: (id) => api.post(`/community/clubs/${id}/join`),
    leave: (id) => api.post(`/community/clubs/${id}/leave`),
    posts: (params) => api.get("/community/posts", { params }),
    createPost: (payload) => api.post("/community/posts", payload),
    upvote: (id) => api.post(`/community/posts/${id}/upvote`),
    votePoll: (id, optionIndex) => api.post(`/community/posts/${id}/vote`, { optionIndex }),
    removePost: (id) => api.delete(`/community/posts/${id}`),
};
