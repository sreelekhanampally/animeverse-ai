import { useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { VideoCard, VideoCardSkeleton } from "./VideoCard";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { cn } from "@/utils/cn";

/**
 * Netflix-style horizontal scroller of VideoCards.
 * Falls back to responsive grid on mobile.
 */
export function VideoRow({
    videos,
    isLoading,
    error,
    onRetry,
    skeletonCount = 6,
    emptyIcon,
    emptyTitle = "Nothing here yet",
    emptyMessage,
    renderCard,
    className,
}) {
    const scrollerRef = useRef(null);
    const scrollBy = (dir) => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
    };

    if (error) {
        return (
            <ErrorState
                title="Couldn't load"
                message="Something went wrong loading this row."
                onRetry={onRetry}
            />
        );
    }

    if (!isLoading && (!videos || videos.length === 0)) {
        return (
            <EmptyState
                icon={emptyIcon}
                title={emptyTitle}
                message={emptyMessage || "Come back soon — new drops land daily."}
            />
        );
    }

    return (
        <div className={cn("relative -mx-1 sm:mx-0", className)}>
            <button
                type="button"
                aria-label="Scroll left"
                onClick={() => scrollBy(-1)}
                className="absolute -left-2 top-1/2 z-10 hidden -translate-y-[calc(50%+20px)] items-center justify-center rounded-full border border-white/10 bg-bg/70 p-2 text-white/85 backdrop-blur transition hover:bg-bg lg:inline-flex"
            >
                <ChevronLeft className="h-5 w-5" />
            </button>
            <button
                type="button"
                aria-label="Scroll right"
                onClick={() => scrollBy(1)}
                className="absolute -right-2 top-1/2 z-10 hidden -translate-y-[calc(50%+20px)] items-center justify-center rounded-full border border-white/10 bg-bg/70 p-2 text-white/85 backdrop-blur transition hover:bg-bg lg:inline-flex"
            >
                <ChevronRight className="h-5 w-5" />
            </button>

            <div
                ref={scrollerRef}
                className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 pl-1 pr-1 sm:gap-5"
                style={{ scrollbarWidth: "none" }}
            >
                {isLoading
                    ? Array.from({ length: skeletonCount }).map((_, i) => (
                          <div
                              key={`sk-${i}`}
                              className="min-w-[240px] max-w-[280px] flex-1 shrink-0 snap-start sm:min-w-[280px]"
                          >
                              <VideoCardSkeleton />
                          </div>
                      ))
                    : videos.map((v, i) => (
                          <motion.div
                              key={v._id || v.id || i}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.25, delay: i * 0.03 }}
                              className="min-w-[240px] max-w-[280px] flex-1 shrink-0 snap-start sm:min-w-[280px]"
                          >
                              {renderCard ? renderCard(v) : <VideoCard video={v} />}
                          </motion.div>
                      ))}
            </div>
        </div>
    );
}
