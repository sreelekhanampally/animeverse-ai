import { useState } from "react";
import { cn } from "@/utils/cn";

const CATEGORIES = [
    "All",
    "Shonen",
    "Seinen",
    "Isekai",
    "Slice of Life",
    "Mecha",
    "Romance",
    "Sports",
    "Music",
    "AMV",
    "Reactions",
    "Reviews",
    "Community",
];

export function CategoryChips({ onChange }) {
    const [active, setActive] = useState("All");
    return (
        <div className="scrollbar-thin flex snap-x items-center gap-2 overflow-x-auto pb-2">
            {CATEGORIES.map((c) => {
                const isActive = c === active;
                return (
                    <button
                        key={c}
                        onClick={() => {
                            setActive(c);
                            onChange?.(c);
                        }}
                        className={cn(
                            "shrink-0 snap-start rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                            isActive
                                ? "border-primary/60 bg-primary/20 text-white shadow-glow"
                                : "border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.07] hover:text-white"
                        )}
                    >
                        {c}
                    </button>
                );
            })}
        </div>
    );
}
