import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
    Home,
    Flame,
    Users,
    Rss,
    ListVideo,
    History,
    ThumbsUp,
    Clock,
    LayoutDashboard,
    Sparkles,
    Bot,
    Settings,
    X,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { PATHS } from "@/routes/paths";
import { useUiStore } from "@/store/uiStore";
import { Logo } from "@/components/common/Logo";

const MAIN_ITEMS = [
    { to: PATHS.home, label: "Home", icon: Home },
    { to: PATHS.trending, label: "Trending", icon: Flame },
    { to: PATHS.community, label: "Community", icon: Users },
    { to: PATHS.subscriptions, label: "Subscriptions", icon: Rss },
];

const LIBRARY_ITEMS = [
    { to: PATHS.playlists, label: "Playlists", icon: ListVideo },
    { to: PATHS.history, label: "History", icon: History },
    { to: PATHS.liked, label: "Liked Videos", icon: ThumbsUp },
    { to: PATHS.watchLater, label: "Watch Later", icon: Clock },
];

const CREATOR_ITEMS = [
    { to: PATHS.dashboard, label: "Dashboard", icon: LayoutDashboard },
];

const AI_ITEMS = [
    { to: PATHS.aiSearch, label: "AI Search", icon: Sparkles, tint: "accent" },
    { to: PATHS.aiChat, label: "AI Chat", icon: Bot, tint: "accent" },
];

const SETTINGS_ITEMS = [{ to: PATHS.settings, label: "Settings", icon: Settings }];

function SectionLabel({ children, collapsed }) {
    if (collapsed) return <div className="my-2 h-px bg-white/5" />;
    return (
        <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            {children}
        </div>
    );
}

function Item({ to, label, icon: Icon, collapsed, tint, onNavigate }) {
    return (
        <NavLink
            to={to}
            end={to === PATHS.home}
            onClick={onNavigate}
            className={({ isActive }) =>
                cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                    collapsed && "justify-center px-0",
                    isActive
                        ? "bg-gradient-to-r from-primary/25 to-primary/5 text-white"
                        : "text-white/75 hover:bg-white/[0.06] hover:text-white"
                )
            }
        >
            {({ isActive }) => (
                <>
                    {isActive && (
                        <motion.span
                            layoutId="sidebar-active"
                            className="absolute inset-y-1 left-0 w-1 rounded-r-full bg-gradient-to-b from-primary to-accent"
                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                    )}
                    <Icon
                        className={cn(
                            "h-5 w-5 shrink-0",
                            isActive && "text-white",
                            tint === "accent" && "text-accent"
                        )}
                    />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {!collapsed && tint === "accent" && (
                        <span className="ml-auto rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                            AI
                        </span>
                    )}
                </>
            )}
        </NavLink>
    );
}

function SidebarNav({ collapsed, onNavigate }) {
    return (
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
            {!collapsed && <SectionLabel>Discover</SectionLabel>}
            {MAIN_ITEMS.map((it) => (
                <Item key={it.to} {...it} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
            {!collapsed && <SectionLabel>Library</SectionLabel>}
            {LIBRARY_ITEMS.map((it) => (
                <Item key={it.to} {...it} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
            {!collapsed && <SectionLabel>Creator</SectionLabel>}
            {CREATOR_ITEMS.map((it) => (
                <Item key={it.to} {...it} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
            {!collapsed && <SectionLabel>Intelligence</SectionLabel>}
            {AI_ITEMS.map((it) => (
                <Item key={it.to} {...it} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
            {!collapsed && <SectionLabel>System</SectionLabel>}
            {SETTINGS_ITEMS.map((it) => (
                <Item key={it.to} {...it} collapsed={collapsed} onNavigate={onNavigate} />
            ))}

            {!collapsed && (
                <div className="mt-6 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-transparent to-accent/15 p-4">
                    <div className="flex items-center gap-2 font-display text-sm font-semibold text-white">
                        <Sparkles className="h-4 w-4 text-accent" /> Neural Recap
                    </div>
                    <p className="mt-1 text-xs text-muted">
                        AI-powered summaries, semantic search, and chat land in Session 2.
                    </p>
                </div>
            )}
        </nav>
    );
}

export function DesktopSidebar() {
    const collapsed = !useUiStore((s) => s.sidebarOpen);
    return (
        <aside
            className={cn(
                "sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 border-r border-white/5 bg-bg/60 backdrop-blur-xl transition-[width] duration-300 lg:flex lg:flex-col",
                collapsed ? "w-[76px]" : "w-64"
            )}
            aria-label="Primary"
        >
            <SidebarNav collapsed={collapsed} />
        </aside>
    );
}

export function MobileSidebar() {
    const open = useUiStore((s) => s.sidebarMobileOpen);
    const close = useUiStore((s) => s.closeMobileSidebar);
    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
                        onClick={close}
                        aria-hidden
                    />
                    <motion.aside
                        initial={{ x: "-100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "-100%" }}
                        transition={{ type: "tween", ease: "easeOut", duration: 0.25 }}
                        className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/10 bg-bg/95 backdrop-blur-2xl lg:hidden"
                        role="dialog"
                        aria-label="Navigation"
                    >
                        <div className="flex h-16 items-center justify-between px-4">
                            <Logo />
                            <button
                                onClick={close}
                                className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
                                aria-label="Close sidebar"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <SidebarNav collapsed={false} onNavigate={close} />
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}
