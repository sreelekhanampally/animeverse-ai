import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatViews, timeAgo } from "@/utils/format";
import { cn } from "@/utils/cn";

export function VideoDescription({ video }) {
    const [open, setOpen] = useState(false);
    const description = video?.description || "";
    const tags = video?.tags || [];

    return (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                <span className="font-medium">{formatViews(video?.views ?? 0)} views</span>
                {video?.createdAt && (
                    <>
                        <span className="text-muted">•</span>
                        <span className="text-muted">{timeAgo(video.createdAt)}</span>
                    </>
                )}
            </div>

            <AnimatePresence initial={false}>
                <motion.div
                    key={open ? "open" : "closed"}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                >
                    <p
                        className={cn(
                            "mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/85",
                            !open && "line-clamp-3"
                        )}
                    >
                        {description || "No description provided."}
                    </p>
                </motion.div>
            </AnimatePresence>

            {tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {tags.map((t) => (
                        <span
                            key={t}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/80"
                        >
                            #{t}
                        </span>
                    ))}
                </div>
            )}

            {(description?.length > 200 || tags.length > 0) && (
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-white"
                >
                    {open ? (
                        <>
                            Show less <ChevronUp className="h-3.5 w-3.5" />
                        </>
                    ) : (
                        <>
                            Show more <ChevronDown className="h-3.5 w-3.5" />
                        </>
                    )}
                </button>
            )}
        </div>
    );
}
