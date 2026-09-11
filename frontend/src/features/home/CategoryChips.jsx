import { useState } from "react";
import { cn } from "@/utils/cn";

// These values mirror AniList genre strings stamped into imported video tags.
// Keeping this list data-backed makes every chip actually filter a feed.
const CATEGORIES = [
    "All",
    "Action",
    "Adventure",
    "Comedy",
    "Drama",
    "Fantasy",
    "Romance",
    "Sci-Fi",
    "Sports",
    "Supernatural",
];

export function CategoryChips({ onChange, value }) {
    const [internal, setInternal] = useState("All");
    const active = value ?? internal;

    return (
        <div className="scrollbar-thin flex snap-x items-center gap-2 overflow-x-auto pb-2">
            {CATEGORIES.map((category) => {
                const isActive = category === active;
                return (
                    <button
                        key={category}
                        type="button"
                        onClick={() => {
                            setInternal(category);
                            onChange?.(category);
                        }}
                        className={cn(
                            "shrink-0 snap-start rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                            isActive
                                ? "border-primary/60 bg-primary/20 text-white shadow-glow"
                                : "border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.07] hover:text-white"
                        )}
                    >
                        {category}
                    </button>
                );
            })}
        </div>
    );
}
