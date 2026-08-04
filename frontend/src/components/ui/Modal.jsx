import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

export function Modal({ open, onClose, title, description, children, size = "md", className }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => e.key === "Escape" && onClose?.();
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    const width = {
        sm: "max-w-sm",
        md: "max-w-lg",
        lg: "max-w-2xl",
        xl: "max-w-4xl",
    }[size];

    return (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 bg-black/70 backdrop-blur-md"
                        onClick={onClose}
                    />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className={cn(
                            "relative z-10 w-full overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur-2xl",
                            width,
                            className
                        )}
                    >
                        {(title || onClose) && (
                            <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
                                <div>
                                    {title && (
                                        <h3 className="font-display text-lg font-semibold text-white">
                                            {title}
                                        </h3>
                                    )}
                                    {description && (
                                        <p className="mt-1 text-sm text-muted">{description}</p>
                                    )}
                                </div>
                                {onClose && (
                                    <button
                                        onClick={onClose}
                                        className="rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-white"
                                        aria-label="Close"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="p-5">{children}</div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = "Confirm", danger = true, loading }) {
    return (
        <Modal open={open} onClose={onClose} title={title} description={message} size="sm">
            <div className="flex justify-end gap-2">
                <button
                    onClick={onClose}
                    className="btn-ghost"
                    disabled={loading}
                >
                    Cancel
                </button>
                <button
                    onClick={onConfirm}
                    disabled={loading}
                    className={cn(
                        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition active:scale-95 disabled:opacity-60",
                        danger
                            ? "bg-rose-500 text-white hover:bg-rose-600"
                            : "bg-primary text-white hover:bg-primary-600"
                    )}
                >
                    {loading ? "Working…" : confirmText}
                </button>
            </div>
        </Modal>
    );
}