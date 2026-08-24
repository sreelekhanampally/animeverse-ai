import { motion } from "framer-motion";
import { Play, Sparkles, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PATHS } from "@/routes/paths";
import { usePlatformStats } from "@/features/home/hooks";
import { formatCount } from "@/utils/format";

export function HeroBanner() {
    const { data: stats, isLoading, isError } = usePlatformStats();

    /**
     * Every one of the three states has to render something: the hero is the
     * first block on the page and is not gated behind a page loader, so there is
     * no state in which these pills are allowed to be blank or to throw.
     *
     * "..." while in flight (never the raw key, which is what made the previous
     * placeholder text visible), "--" if the request failed or came back without
     * a usable number. A stats outage therefore costs two characters and leaves
     * the rest of the homepage working.
     */
    const statValue = (key) => {
        if (isLoading) return "...";
        const value = stats?.[key];
        if (isError || typeof value !== "number") return "--";
        return formatCount(value);
    };

    return (
        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-primary/25 via-transparent to-accent/20 p-6 sm:p-8 md:p-10">
            {/* Decorations */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
            <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]"
                viewBox="0 0 800 400"
                preserveAspectRatio="none"
            >
                <defs>
                    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
                    </pattern>
                </defs>
                <rect width="800" height="400" fill="url(#grid)" />
            </svg>

            <div className="relative grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-accent">
                        <Sparkles className="h-3 w-3" /> OPEN BETA · v0.4
                    </div>
                    <h1 className="max-w-2xl font-display text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                        <span>You know the scene. </span>
                    </h1>
                    <h1 className="max-w-2xl font-display text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                        <span>You just can't name it. </span>
                    </h1>
                    {/* <span className="gradient-text">Every Anime Universe</span> */}
                    <p className="mt-3 max-w-xl text-sm text-white/75 sm:text-base">
                        Describe it badly. “Rain fight, red umbrella, maybe episode 12.” AnimeVerse finds the scene, episode, and timestamp.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <Link
                            to={PATHS.trending}
                            className="btn-primary"
                        >
                            <Play className="h-4 w-4" fill="currentColor" /> Start Watching
                        </Link>
                        <Link to={PATHS.aiSearch} className="btn-ghost">
                            <Sparkles className="h-4 w-4 text-accent" /> Find a Scene
                            <ChevronRight className="h-4 w-4" />
                        </Link>
                    </div>
                </motion.div>

                {/* Stat pills */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="grid grid-cols-3 gap-3"
                >
                    {[
                        { k: statValue("videosCount"), v: "Videos" },
                        { k: statValue("creatorsCount"), v: "Creators" },
                        { k: "AI", v: "Companion " },
                    ].map((s) => (
                        <div
                            key={s.v}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center backdrop-blur"
                        >
                            <div className="font-display text-2xl font-bold text-white">{s.k}</div>
                            <div className="mt-1 text-[11px] uppercase tracking-widest text-muted">{s.v}</div>
                        </div>
                    ))}
                </motion.div>
            </div>
        </section>
    );
}
