const ACCESS_KEY = "av_access_token";

export const tokenStore = {
    get: () => {
        try {
            return localStorage.getItem(ACCESS_KEY);
        } catch {
            return null;
        }
    },
    set: (token) => {
        try {
            if (token) localStorage.setItem(ACCESS_KEY, token);
            else localStorage.removeItem(ACCESS_KEY);
        } catch {
            /* noop */
        }
    },
    clear: () => {
        try {
            localStorage.removeItem(ACCESS_KEY);
        } catch {
            /* noop */
        }
    },
};
