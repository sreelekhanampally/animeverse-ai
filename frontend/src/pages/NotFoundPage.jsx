import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Home, Sparkles } from "lucide-react";
import { Logo } from "@/components/common/Logo";
import { PATHS } from "@/routes/paths";

export default function NotFoundPage() {
    return (
        <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
            <div className="pointer-events-none absolute inset-0 -z-10">
                <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/25 blur-3xl" />
                <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
            </div>

            <Logo className="mb-8" />

            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="gradient-text font-display text-[110px] font-bold leading-none sm:text-[160px]"
            >
                404
            </motion.div>
            <h1 className="mt-3 font-display text-2xl font-semibold text-white sm:text-3xl">
                Lost in the AnimeVerse
            </h1>
            <p className="mt-2 max-w-md text-sm text-muted">
                This page slipped into another dimension. Let's get you back home.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link to={PATHS.home} className="btn-primary">
                    <Home className="h-4 w-4" /> Back to home
                </Link>
                <Link to={PATHS.aiSearch} className="btn-ghost">
                    <Sparkles className="h-4 w-4 text-accent" /> Ask the AI
                </Link>
            </div>
        </div>
    );
}
