import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function ErrorState({
    title = "Something went sideways",
    message = "We couldn't load this section. Please try again.",
    onRetry,
    className,
}) {
    return (
        <div className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-10 text-center ${className || ""}`}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20 text-rose-300">
                <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
                <h4 className="font-display text-lg font-semibold text-white">{title}</h4>
                <p className="mt-1 max-w-md text-sm text-muted">{message}</p>
            </div>
            {onRetry && (
                <Button variant="ghost" size="sm" onClick={onRetry}>
                    <RefreshCw className="h-4 w-4" />
                    Try again
                </Button>
            )}
        </div>
    );
}
