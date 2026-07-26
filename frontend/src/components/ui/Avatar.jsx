import { useState } from "react";
import { cn } from "@/utils/cn";
import { initials } from "@/utils/format";

const sizeMap = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
    xl: "h-16 w-16 text-lg",
};

export function Avatar({ src, alt = "", name = "", size = "md", className, ring = false }) {
    const [failed, setFailed] = useState(false);
    const showImage = src && !failed;
    return (
        <div
            className={cn(
                "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary/40 to-accent/40 font-semibold text-white",
                sizeMap[size] || sizeMap.md,
                ring && "ring-2 ring-primary/60 ring-offset-2 ring-offset-bg",
                className
            )}
            aria-label={alt || name}
        >
            {showImage ? (
                <img
                    src={src}
                    alt={alt || name}
                    loading="lazy"
                    onError={() => setFailed(true)}
                    className="h-full w-full object-cover"
                />
            ) : (
                <span>{initials(name || alt || "?") || "?"}</span>
            )}
        </div>
    );
}
