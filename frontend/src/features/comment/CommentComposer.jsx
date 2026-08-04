import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Smile, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import { useAuth } from "@/contexts/AuthContext";

const QUICK_EMOJI = ["❤️", "🔥", "😂", "😭", "👏", "✨", "🥹", "🤯", "😳", "🍿", "🗡️", "⚔️"];

export function CommentComposer({
    onSubmit,
    onCancel,
    submitting,
    initialValue = "",
    autoFocus,
    placeholder = "Add a comment…",
    compact = false,
}) {
    const { user } = useAuth();
    const [value, setValue] = useState(initialValue);
    const [showEmoji, setShowEmoji] = useState(false);
    const [focused, setFocused] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    const submit = async (e) => {
        e?.preventDefault();
        const v = value.trim();
        if (!v || submitting) return;
        try {
            await onSubmit?.(v);
            setValue("");
            setFocused(false);
        } catch {
            /* toast handled upstream */
        }
    };

    const insertEmoji = (emoji) => {
        setValue((v) => `${v}${emoji}`);
        setShowEmoji(false);
        inputRef.current?.focus();
    };

    return (
        <form onSubmit={submit} className={cn("flex gap-3", compact && "gap-2")}>
            <Avatar size={compact ? "xs" : "sm"} src={user?.avatar} name={user?.fullName || user?.username || "?"} />
            <div className="relative flex-1">
                <div
                    className={cn(
                        "flex items-end gap-2 rounded-2xl border bg-white/[0.04] px-3 py-2 transition",
                        focused || value
                            ? "border-primary/50 shadow-[0_0_0_3px_rgba(124,58,237,0.18)]"
                            : "border-white/10"
                    )}
                >
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={value}
                        onChange={(e) => {
                            setValue(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`;
                        }}
                        onFocus={() => setFocused(true)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
                        }}
                        placeholder={placeholder}
                        className="max-h-48 min-h-[36px] flex-1 resize-none bg-transparent text-sm text-white placeholder:text-muted/70 outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => setShowEmoji((v) => !v)}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-white"
                        aria-label="Insert emoji"
                    >
                        <Smile className="h-4 w-4" />
                    </button>
                </div>

                <AnimatePresence>
                    {showEmoji && (
                        <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full z-20 mt-2 flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-card/95 p-2 shadow-2xl backdrop-blur-xl"
                        >
                            {QUICK_EMOJI.map((e) => (
                                <button
                                    key={e}
                                    type="button"
                                    onClick={() => insertEmoji(e)}
                                    className="rounded-lg px-2 py-1 text-lg hover:bg-white/10"
                                >
                                    {e}
                                </button>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {(focused || value || onCancel) && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-2 flex items-center justify-end gap-2"
                        >
                            {onCancel && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setValue("");
                                        setFocused(false);
                                        onCancel();
                                    }}
                                    className="rounded-lg px-3 py-1.5 text-xs text-muted transition hover:bg-white/10 hover:text-white"
                                >
                                    <span className="inline-flex items-center gap-1">
                                        <X className="h-3.5 w-3.5" /> Cancel
                                    </span>
                                </button>
                            )}
                            <Button
                                type="submit"
                                variant="primary"
                                size="sm"
                                disabled={!value.trim()}
                                loading={submitting}
                            >
                                <Send className="h-3.5 w-3.5" />
                                {onCancel ? "Reply" : "Post"}
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </form>
    );
}