import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    Search,
    Bell,
    Menu,
    Sparkles,
    Upload,
    LogOut,
    Settings as SettingsIcon,
    User,
    Bookmark,
    History,
} from "lucide-react";
import { Logo } from "@/components/common/Logo";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import {
    Dropdown,
    DropdownItem,
    DropdownLabel,
    DropdownSeparator,
} from "@/components/ui/Dropdown";
import { useAuth } from "@/contexts/AuthContext";
import { useUiStore } from "@/store/uiStore";
import { PATHS } from "@/routes/paths";

export function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [q, setQ] = useState("");
    const toggleSidebar = useUiStore((s) => s.toggleSidebar);
    const openMobileSidebar = useUiStore((s) => s.openMobileSidebar);

    const onSearch = (e) => {
        e.preventDefault();
        const query = q.trim();
        if (!query) return;
        navigate(`${PATHS.aiSearch}?q=${encodeURIComponent(query)}`);
    };

    const handleLogout = async () => {
        await logout();
        navigate(PATHS.home);
    };

    return (
        <header className="sticky top-0 z-40 border-b border-white/5 bg-bg/70 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-3 sm:px-4 lg:px-6">
                {/* Sidebar toggles */}
                <IconButton
                    aria-label="Toggle sidebar"
                    className="hidden lg:inline-flex"
                    onClick={toggleSidebar}
                >
                    <Menu className="h-5 w-5" />
                </IconButton>
                <IconButton
                    aria-label="Open sidebar"
                    className="inline-flex lg:hidden"
                    onClick={openMobileSidebar}
                >
                    <Menu className="h-5 w-5" />
                </IconButton>

                <Logo className="mr-2 hidden md:inline-flex" />
                <Logo compact className="mr-2 inline-flex md:hidden" />

                {/* Search */}
                <form
                    onSubmit={onSearch}
                    className="relative ml-auto hidden max-w-xl flex-1 md:block"
                >
                    <div className="group relative">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
                            <Search className="h-4 w-4" />
                        </span>
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search anime, creators, communities…"
                            className="h-11 w-full rounded-full border border-white/10 bg-white/[0.04] pl-11 pr-24 text-sm text-white placeholder:text-muted/70 outline-none transition focus:border-primary/60 focus:bg-white/[0.06] focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)]"
                            aria-label="Search"
                        />
                        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                            <span className="hidden items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent lg:inline-flex">
                                <Sparkles className="h-3 w-3" /> AI
                            </span>
                            <button
                                type="submit"
                                className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-glow transition hover:bg-primary-600"
                            >
                                Search
                            </button>
                        </span>
                    </div>
                </form>

                {/* Mobile search icon */}
                <IconButton
                    aria-label="Search"
                    className="ml-auto md:hidden"
                    onClick={() => navigate(PATHS.aiSearch)}
                >
                    <Search className="h-5 w-5" />
                </IconButton>

                {/* Right cluster */}
                <div className="flex items-center gap-2">
                    {user ? (
                        <>
                            <Button variant="ghost" size="sm" className="hidden md:inline-flex">
                                <Upload className="h-4 w-4" />
                                Upload
                            </Button>

                            <Dropdown
                                trigger={
                                    <IconButton aria-label="Notifications">
                                        <span className="relative">
                                            <Bell className="h-5 w-5" />
                                            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg,#0f172a)]" />
                                        </span>
                                    </IconButton>
                                }
                            >
                                <DropdownLabel>Notifications</DropdownLabel>
                                <div className="px-3 py-6 text-center text-sm text-muted">
                                    You're all caught up.
                                </div>
                            </Dropdown>

                            <Dropdown
                                trigger={
                                    <button
                                        className="rounded-full ring-1 ring-white/10 transition hover:ring-primary/60"
                                        aria-label="Open user menu"
                                    >
                                        <Avatar
                                            size="sm"
                                            src={user.avatar}
                                            name={user.fullName || user.username}
                                        />
                                    </button>
                                }
                            >
                                <div className="flex items-center gap-3 px-3 py-2">
                                    <Avatar src={user.avatar} name={user.fullName || user.username} />
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-white">
                                            {user.fullName || user.username}
                                        </div>
                                        <div className="truncate text-xs text-muted">@{user.username}</div>
                                    </div>
                                </div>
                                <DropdownSeparator />
                                <DropdownItem
                                    icon={<User className="h-4 w-4" />}
                                    onClick={() => navigate(`/c/${user.username}`)}
                                >
                                    Your channel
                                </DropdownItem>
                                <DropdownItem
                                    icon={<History className="h-4 w-4" />}
                                    onClick={() => navigate(PATHS.history)}
                                >
                                    Watch history
                                </DropdownItem>
                                <DropdownItem
                                    icon={<Bookmark className="h-4 w-4" />}
                                    onClick={() => navigate(PATHS.watchLater)}
                                >
                                    Watch later
                                </DropdownItem>
                                <DropdownItem
                                    icon={<SettingsIcon className="h-4 w-4" />}
                                    onClick={() => navigate(PATHS.settings)}
                                >
                                    Settings
                                </DropdownItem>
                                <DropdownSeparator />
                                <DropdownItem
                                    icon={<LogOut className="h-4 w-4" />}
                                    danger
                                    onClick={handleLogout}
                                >
                                    Log out
                                </DropdownItem>
                            </Dropdown>
                        </>
                    ) : (
                        <>
                            <Link to={PATHS.login}>
                                <Button variant="ghost" size="sm">Log in</Button>
                            </Link>
                            <Link to={PATHS.register} className="hidden sm:inline-flex">
                                <Button variant="primary" size="sm">Sign up</Button>
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}
