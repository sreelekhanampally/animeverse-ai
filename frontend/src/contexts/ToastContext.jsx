import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/utils/cn";

const ToastContext = createContext(null);

const iconFor = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
};

const styleFor = {
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    error: "border-rose-500/40 bg-rose-500/10 text-rose-100",
    info: "border-cyan-500/40 bg-cyan-500/10 text-cyan-100",
};

let idSeq = 0;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const dismiss = useCallback((id) => {
        setToasts((t) => t.filter((x) => x.id !== id));
    }, []);

    const push = useCallback(
        (message, opts = {}) => {
            const id = ++idSeq;
            const toast = {
                id,
                message,
                type: opts.type || "info",
                duration: opts.duration ?? 3200,
            };
            setToasts((t) => [...t, toast]);
            if (toast.duration > 0) {
                setTimeout(() => dismiss(id), toast.duration);
            }
            return id;
        },
        [dismiss]
    );

    const api = useMemo(
        () => ({
            toast: push,
            success: (m, o) => push(m, { ...o, type: "success" }),
            error: (m, o) => push(m, { ...o, type: "error" }),
            info: (m, o) => push(m, { ...o, type: "info" }),
            dismiss,
        }),
        [push, dismiss]
    );

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
                <AnimatePresence initial={false}>
                    {toasts.map((t) => {
                        const Icon = iconFor[t.type] || Info;
                        return (
                            <motion.div
                                key={t.id}
                                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, x: 40 }}
                                transition={{ duration: 0.22 }}
                                className={cn(
                                    "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 backdrop-blur-xl shadow-xl",
                                    styleFor[t.type]
                                )}
                                role="status"
                            >
                                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                                <div className="flex-1 text-sm">{t.message}</div>
                                <button
                                    onClick={() => dismiss(t.id)}
                                    className="rounded-md p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
                                    aria-label="Dismiss"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used within ToastProvider");
    return ctx;
};
