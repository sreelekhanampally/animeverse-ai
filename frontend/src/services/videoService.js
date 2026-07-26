import { apiClient } from "./apiClient";

export const videoService = {
    list: (params) => apiClient.get("/videos", { params }),
    byId: (id) => apiClient.get(`/videos/${id}`),
    trending: (params) => apiClient.get("/videos", { params: { sortBy: "views", sortType: "desc", ...params } }),
    latest: (params) => apiClient.get("/videos", { params: { sortBy: "createdAt", sortType: "desc", ...params } }),
    recommended: (params) => apiClient.get("/videos", { params: { sortBy: "createdAt", sortType: "desc", ...params } }),
    publish: (formData) =>
        apiClient.post("/videos", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        }),
    update: (id, formData) => apiClient.patch(`/videos/${id}`, formData),
    remove: (id) => apiClient.delete(`/videos/${id}`),
    togglePublish: (id) => apiClient.patch(`/videos/toggle/publish/${id}`),
};
