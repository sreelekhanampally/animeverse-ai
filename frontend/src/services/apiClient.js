import axios from "axios";
import { tokenStore } from "@/utils/token";

const baseURL = import.meta.env.VITE_API_URL || "/api/v1";

/**
 * 30s is right for ordinary JSON calls — it surfaces a dead backend quickly.
 * It is far too short for a file upload: the browser has to push the whole file
 * over the wire AND wait for the server to relay it to Cloudinary and get a URL
 * back before any response arrives.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 10 minutes for multipart requests. multer accepts files up to 200MB, so on a
 * slow connection the transfer alone can exceed any short limit.
 *
 * This is not a cosmetic change. Aborting the request client-side does NOT cancel
 * the work: the server keeps going, finishes the Cloudinary upload and creates the
 * Video document. The user sees a failure, retries, and every retry produces
 * another complete copy — a real upload of a ~280s video took ~35s here and left
 * four identical documents with four separate Cloudinary assets.
 */
export const UPLOAD_TIMEOUT_MS = 600_000;

export const apiClient = axios.create({
    baseURL,
    withCredentials: true,
    timeout: DEFAULT_TIMEOUT_MS,
});

/**
 * Applied centrally rather than at each call site so no future multipart request
 * silently inherits the short timeout. Detecting FormData is more reliable than
 * checking a manually-set Content-Type header, which the browser rewrites anyway
 * in order to add the multipart boundary.
 */
apiClient.interceptors.request.use((cfg) => {
    const isUpload =
        typeof FormData !== "undefined" && cfg.data instanceof FormData;
    if (isUpload && cfg.timeout === DEFAULT_TIMEOUT_MS) {
        cfg.timeout = UPLOAD_TIMEOUT_MS;
    }
    return cfg;
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
