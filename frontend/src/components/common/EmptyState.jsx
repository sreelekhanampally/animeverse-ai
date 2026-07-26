import { Sparkles } from "lucide-react";

export function EmptyState({
    icon,
    title = "Nothing here yet",
    message = "As soon as content lands, it will show up right here.",
    action,
    className,
}) {
    const Icon = icon || Sparkles;
    return (
        <div className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-12 text-center ${className || ""}`}>
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-accent/30 text-white">
                <Icon className="h-6 w-6" />
            </div>
            <div>
                <h4 className="font-display text-lg font-semibold text-white">{title}</h4>
                <p className="mt-1 max-w-md text-sm text-muted">{message}</p>
            </div>
            {action}
        </div>
    );
}
