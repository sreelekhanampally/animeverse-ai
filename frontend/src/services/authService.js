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
};
