import { create } from "zustand";

export const useAuthStore = create((set) => ({
    user: null,
    loading: true,
    setUser: (user) => set({ user }),
    setLoading: (loading) => set({ loading }),
    reset: () => set({ user: null, loading: false }),
}));
