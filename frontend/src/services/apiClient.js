import axios from "axios";
import { tokenStore } from "@/utils/token";

const baseURL = import.meta.env.VITE_API_URL || "/api/v1";

export const apiClient = axios.create({
    baseURL,
    withCredentials: true,
    timeout: 30_000,
});

apiClient.interceptors.request.use((cfg) => {
    const t = tokenStore.get();
    if (t) {
        cfg.headers = cfg.headers || {};
        cfg.headers.Authorization = `Bearer ${t}`;
    }
    return cfg;
});

let refreshPromise = null;
const authListeners = new Set();

export const onUnauthorized = (fn) => {
    authListeners.add(fn);
    return () => authListeners.delete(fn);
};

const notifyUnauthorized = () => {
    authListeners.forEach((fn) => {
        try {
            fn();
        } catch {
            /* noop */
        }
    });
};

apiClient.interceptors.response.use(
    (r) => r,
    async (error) => {
        const original = error.config || {};
        const status = error.response?.status;
        const url = original.url || "";

        const isAuthRoute =
            url.includes("/users/login") ||
            url.includes("/users/register") ||
            url.includes("/users/refresh-token");

        if (status === 401 && !original._retry && !isAuthRoute) {
            original._retry = true;
            try {
                refreshPromise =
                    refreshPromise ||
                    apiClient
                        .post("/users/refresh-token")
                        .finally(() => {
                            refreshPromise = null;
                        });
                const r = await refreshPromise;
                const newAccess = r?.data?.data?.accessToken;
                if (newAccess) tokenStore.set(newAccess);
                return apiClient(original);
            } catch (e) {
                tokenStore.clear();
                notifyUnauthorized();
                return Promise.reject(e);
            }
        }
        return Promise.reject(error);
    }
);

export function extractErrorMessage(err, fallback = "Something went wrong") {
    return (
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        fallback
    );
}
