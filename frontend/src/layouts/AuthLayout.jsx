import { Outlet, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Logo } from "@/components/common/Logo";

export function AuthLayout() {
    return (
        <div className="relative min-h-screen overflow-hidden">
            {/* Ambient background */}
            <div className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
                <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-accent/15 blur-3xl" />
                <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.4)_1px,transparent_1px)] [background-size:40px_40px]" />
            </div>

            <header className="flex items-center justify-between px-6 py-6 md:px-10">
                <Logo />
                <Link to="/" className="text-sm text-muted hover:text-white">
                    Back to home
                </Link>
            </header>

            <div className="mx-auto grid min-h-[calc(100vh-88px)] w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 pb-10 md:px-10 lg:grid-cols-2">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="hidden lg:block"
                >
                    <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs uppercase tracking-wider text-accent">
                        Where Anime Meets AI
                    </div>
                    <h1 className="font-display text-5xl font-bold leading-tight text-white">
                        Enter the <span className="gradient-text">AnimeVerse</span>.
                    </h1>
                    <p className="mt-4 max-w-md text-base text-muted">
                        Watch. Discuss. Discover. A social video platform built for anime fans -
                        with an AI companion that actually understands your taste.
                    </p>

                    <ul className="mt-8 space-y-3 text-sm text-white/85">
                        {[
                            "Semantic search across every episode and community post",
                            "Creator playlists, communities, and reactive AI chat",
                            "Deep recommendations tuned to your watch history",
                        ].map((line) => (
                            <li key={line} className="flex items-start gap-3">
                                <span className="mt-1 h-2 w-2 rounded-full bg-gradient-to-r from-primary to-accent" />
                                {line}
                            </li>
                        ))}
                    </ul>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="mx-auto w-full max-w-md"
                >
                    <div className="gradient-border rounded-3xl">
                        <div className="rounded-3xl bg-card/70 p-6 backdrop-blur-2xl sm:p-8">
                            <Outlet />
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
