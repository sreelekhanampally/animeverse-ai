import { Sparkles } from "lucide-react";

export function FullPageLoader() {
    return (
        <div className="flex min-h-screen w-full items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="relative">
                    <div className="h-14 w-14 animate-[spin_1.4s_linear_infinite] rounded-full border-2 border-white/10 border-t-primary" />
                    <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-accent" />
                </div>
                <p className="font-display text-sm text-muted">Summoning AnimeVerse…</p>
            </div>
        </div>
    );
}
