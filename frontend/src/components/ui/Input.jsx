import { forwardRef, useId, useState } from "react";
import { cn } from "@/utils/cn";
import { Eye, EyeOff } from "lucide-react";

export const Input = forwardRef(function Input(
    { className, label, error, hint, leftIcon, rightIcon, type = "text", id, ...props },
    ref
) {
    const autoId = useId();
    const inputId = id || autoId;
    const [reveal, setReveal] = useState(false);
    const isPassword = type === "password";
    const effectiveType = isPassword ? (reveal ? "text" : "password") : type;

    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label htmlFor={inputId} className="text-xs font-medium text-white/80">
                    {label}
                </label>
            )}
            <div className="relative">
                {leftIcon && (
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                        {leftIcon}
                    </span>
                )}
                <input
                    ref={ref}
                    id={inputId}
                    type={effectiveType}
                    className={cn(
                        "input-base",
                        leftIcon && "pl-10",
                        (rightIcon || isPassword) && "pr-10",
                        error && "border-rose-500/60 focus:border-rose-500/80 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.18)]",
                        className
                    )}
                    aria-invalid={!!error || undefined}
                    aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
                    {...props}
                />
                {isPassword ? (
                    <button
                        type="button"
                        onClick={() => setReveal((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:bg-white/10 hover:text-white"
                        aria-label={reveal ? "Hide password" : "Show password"}
                        tabIndex={-1}
                    >
                        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                ) : rightIcon ? (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                        {rightIcon}
                    </span>
                ) : null}
            </div>
            {error ? (
                <p id={`${inputId}-error`} className="text-xs text-rose-400">
                    {error}
                </p>
            ) : hint ? (
                <p id={`${inputId}-hint`} className="text-xs text-muted">
                    {hint}
                </p>
            ) : null}
        </div>
    );
});
