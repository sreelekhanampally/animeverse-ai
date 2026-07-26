import { createContext, useContext, useEffect, useCallback } from "react";
import { authService, onUnauthorized } from "@/services";
import { tokenStore } from "@/utils/token";
import { useAuthStore } from "@/store/authStore";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const { user, loading, setUser, setLoading, reset } = useAuthStore();

    const refresh = useCallback(async () => {
        try {
            const r = await authService.me();
            setUser(r.data?.data || null);
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, [setUser, setLoading]);

    useEffect(() => {
        refresh();
        const off = onUnauthorized(() => reset());
        return () => off();
    }, [refresh, reset]);

    const login = useCallback(
        async (payload) => {
            const r = await authService.login(payload);
            const data = r.data?.data || {};
            if (data.accessToken) tokenStore.set(data.accessToken);
            const nextUser = data.user || null;
            setUser(nextUser);
            return nextUser;
        },
        [setUser]
    );

    const register = useCallback(
        async (formData) => {
            const r = await authService.register(formData);
            return r.data?.data;
        },
        []
    );

    const logout = useCallback(async () => {
        try {
            await authService.logout();
        } catch {
            /* ignore */
        }
        tokenStore.clear();
        setUser(null);
    }, [setUser]);

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                isAuthenticated: !!user,
                refresh,
                login,
                register,
                logout,
                setUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
};
