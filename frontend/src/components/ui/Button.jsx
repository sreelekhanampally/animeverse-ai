import { forwardRef } from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/utils/cn";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus-visible:outline-none disabled:opacity-60 disabled:pointer-events-none active:scale-[0.98]",
    {
        variants: {
            variant: {
                primary:
                    "bg-primary text-white shadow-glow hover:bg-primary-600",
                accent: "bg-accent text-white shadow-accent hover:bg-accent-600",
                ghost:
                    "border border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/10",
                outline:
                    "border border-primary/50 bg-transparent text-white hover:bg-primary/10",
                subtle: "bg-white/[0.04] text-white/85 hover:bg-white/[0.08]",
                danger: "bg-rose-500 text-white hover:bg-rose-600",
                link: "text-accent hover:text-accent-600 underline underline-offset-4 px-0",
            },
            size: {
                sm: "h-8 px-3 text-xs",
                md: "h-10 px-4 text-sm",
                lg: "h-12 px-6 text-base",
                icon: "h-10 w-10 p-0",
                iconSm: "h-8 w-8 p-0",
            },
            fullWidth: {
                true: "w-full",
                false: "",
            },
        },
        defaultVariants: {
            variant: "primary",
            size: "md",
            fullWidth: false,
        },
    }
);

export const Button = forwardRef(function Button(
    { className, variant, size, fullWidth, loading, children, disabled, type = "button", ...props },
    ref
) {
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            className={cn(buttonVariants({ variant, size, fullWidth }), className)}
            {...props}
        >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {children}
        </button>
    );
});
