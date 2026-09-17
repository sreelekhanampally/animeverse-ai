import { Sparkles } from "lucide-react";
import { VideoCard } from "@/features/video/VideoCard";

export function ExplainableVideoCard({ video, reasons = [], score, label = "Why this?" }) {
    if (!video) return null;
    const cleanReasons = [...new Set((reasons || []).filter(Boolean))].slice(0, 3);

    return (
        <div className="space-y-2">
            <VideoCard video={video} />
            {(cleanReasons.length > 0 || Number.isFinite(score)) && (
                <div className="rounded-xl border border-accent/15 bg-accent/[0.04] px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-accent">
                        <span className="inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3" /> {label}
                        </span>
                        {Number.isFinite(score) && (
                            <span className="text-muted">{Math.round(Math.max(0, score) * 100)}% match</span>
                        )}
                    </div>
                    {cleanReasons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {cleanReasons.map((reason) => (
                                <span
                                    key={reason}
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] leading-tight text-white/75"
                                >
                                    {reason}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
