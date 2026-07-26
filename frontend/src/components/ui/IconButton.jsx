import { forwardRef } from "react";
import { cn } from "@/utils/cn";

export const IconButton = forwardRef(function IconButton(
    { className, children, "aria-label": ariaLabel, size = "md", active = false, ...props },
    ref
) {
    return (
        <button
            ref={ref}
            aria-label={ariaLabel}
            className={cn(
                "relative inline-flex items-center justify-center rounded-xl border text-white/85 transition-all active:scale-95",
                size === "sm" ? "h-8 w-8" : "h-10 w-10",
                active
                    ? "border-primary/50 bg-primary/15 text-white"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/10 hover:text-white",
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
});
