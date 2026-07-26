import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";

export function Logo({ compact = false, className }) {
    return (
        <Link
            to="/"
            className={cn(
                "group inline-flex items-center gap-2 select-none",
                className
            )}
            aria-label="AnimeVerse AI"
        >
            <span className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary via-fuchsia-500 to-accent shadow-glow transition group-hover:scale-105">
                <span className="absolute inset-0 opacity-40 mix-blend-overlay bg-[radial-gradient(circle_at_30%_20%,#fff,transparent_50%)]" />
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20 L12 4 L20 20" />
                    <path d="M8 14 H16" />
                    <circle cx="12" cy="4" r="0.6" fill="currentColor" />
                </svg>
            </span>
            {!compact && (
                <span className="font-display text-[15px] font-semibold leading-none">
                    <span className="text-white">Anime</span>
                    <span className="gradient-text">Verse</span>
                    <span className="ml-1 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">AI</span>
                </span>
            )}
        </Link>
    );
}
