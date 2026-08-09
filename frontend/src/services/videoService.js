import { apiClient } from "./apiClient";

export const videoService = {
    list: (params) => apiClient.get("/videos", { params }),
    byId: (id) => apiClient.get(`/videos/${id}`),
    trending: (params) => apiClient.get("/videos", { params: { sortBy: "views", sortType: "desc", ...params } }),
    latest: (params) => apiClient.get("/videos", { params: { sortBy: "createdAt", sortType: "desc", ...params } }),
    recommended: (params) => apiClient.get("/videos", { params: { sortBy: "createdAt", sortType: "desc", ...params } }),
    /**
     * `onUploadProgress` is optional, so existing callers keep working unchanged.
     * The long timeout is applied centrally by the apiClient interceptor for any
     * FormData body rather than hardcoded here, so every multipart call gets it.
     */
    publish: (formData, { onUploadProgress } = {}) =>
        apiClient.post("/videos", formData, {
            headers: { "Content-Type": "multipart/form-data" },
            onUploadProgress,
        }),
    update: (id, formData) => apiClient.patch(`/videos/${id}`, formData),
    remove: (id) => apiClient.delete(`/videos/${id}`),
    togglePublish: (id) => apiClient.patch(`/videos/toggle/publish/${id}`),
};
