import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import {
    useNotificationPreferences,
    useUpdateNotificationPreferences,
} from "./hooks";

/**
 * Only categories the backend can actually derive an event for.
 *
 * There is deliberately no "mentions" row: nothing in the codebase parses
 * @mentions, so the switch would govern nothing. The original card copy mentioned
 * it as an example, which is why it's called out here rather than silently
 * dropped.
 */
const ROWS = [
    { key: "uploads", label: "New uploads", hint: "Channels you subscribe to" },
    { key: "comments", label: "Comments", hint: "Replies on your videos" },
    { key: "likes", label: "Likes", hint: "When someone likes your video" },
    { key: "subscribers", label: "New subscribers", hint: "People following your channel" },
    { key: "community", label: "Community", hint: "Posts in your fan clubs" },
];

/** Accessible switch built from a native checkbox so keyboard + labels work. */
function Toggle({ checked, disabled, onChange, label }) {
    return (
        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
                type="checkbox"
                className="peer sr-only"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={label}
            />
            <span
                className={`h-5 w-9 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 peer-disabled:opacity-50 ${
                    checked
                        ? "border-primary/60 bg-primary"
                        : "border-white/15 bg-white/[0.06]"
                }`}
            />
            <span
                className={`pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    checked ? "translate-x-4" : "translate-x-0"
                }`}
            />
        </label>
    );
}

export function NotificationPreferences() {
    const toast = useToast();
    const { data: prefs, isLoading, isError, refetch } = useNotificationPreferences();
    const update = useUpdateNotificationPreferences();

    // Which row is mid-flight, so only that row shows a spinner.
    const pendingKey = update.isPending ? update.variables : null;

    const onToggle = async (key, value) => {
        try {
            await update.mutateAsync({ [key]: value });
        } catch (err) {
            // The hook already rolled the optimistic write back.
            toast.error(extractErrorMessage(err, "Couldn't save that preference"));
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-3">
                {ROWS.map((r) => (
                    <Skeleton key={r.key} className="h-9 w-full" />
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-muted">Couldn't load your notification settings.</p>
                <Button size="sm" variant="ghost" onClick={() => refetch()}>
                    Try again
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {ROWS.map((row) => {
                // A missing key reads as enabled, matching the schema default.
                const checked = prefs?.[row.key] !== false;
                const busy = pendingKey && row.key in pendingKey;
                return (
                    <div key={row.key} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="truncate text-sm text-white/90">{row.label}</div>
                            <div className="truncate text-xs text-muted">{row.hint}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                            <Toggle
                                label={row.label}
                                checked={checked}
                                disabled={update.isPending}
                                onChange={(v) => onToggle(row.key, v)}
                            />
                        </div>
                    </div>
                );
            })}
            <p className="pt-1 text-xs text-muted">
                Saved automatically. Turning a category off removes it from your bell.
            </p>
        </div>
    );
}
