import { cn } from "@/utils/cn";

const variants = {
    default: "bg-white/[0.06] text-white/85 border-white/10",
    primary: "bg-primary/20 text-white border-primary/40",
    accent: "bg-accent/20 text-white border-accent/40",
    success: "bg-emerald-500/20 text-emerald-100 border-emerald-500/40",
    danger: "bg-rose-500/20 text-rose-100 border-rose-500/40",
};

export function Badge({ children, variant = "default", className }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                variants[variant],
                className
            )}
        >
            {children}
        </span>
    );
}
