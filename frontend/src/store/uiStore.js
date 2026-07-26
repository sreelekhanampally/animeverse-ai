import { create } from "zustand";

export const useUiStore = create((set) => ({
    sidebarOpen: true,
    sidebarMobileOpen: false,
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (v) => set({ sidebarOpen: v }),
    openMobileSidebar: () => set({ sidebarMobileOpen: true }),
    closeMobileSidebar: () => set({ sidebarMobileOpen: false }),
    toggleMobileSidebar: () => set((s) => ({ sidebarMobileOpen: !s.sidebarMobileOpen })),
}));
