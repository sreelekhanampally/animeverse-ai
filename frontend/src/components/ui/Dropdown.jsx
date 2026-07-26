import { useEffect, useRef, useState, cloneElement } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/utils/cn";

export function Dropdown({ trigger, children, align = "right", className }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        function onDoc(e) {
            if (!rootRef.current?.contains(e.target)) setOpen(false);
        }
        function onEsc(e) {
            if (e.key === "Escape") setOpen(false);
        }
        if (open) {
            document.addEventListener("mousedown", onDoc);
            document.addEventListener("keydown", onEsc);
        }
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onEsc);
        };
    }, [open]);

    const triggerEl = cloneElement(trigger, {
        onClick: (e) => {
            trigger.props.onClick?.(e);
            setOpen((v) => !v);
        },
        "aria-expanded": open,
        "aria-haspopup": "menu",
    });

    return (
        <div ref={rootRef} className="relative inline-block">
            {triggerEl}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        role="menu"
                        className={cn(
                            "absolute z-50 mt-2 min-w-[220px] rounded-2xl border border-white/10 bg-card/95 p-2 shadow-2xl backdrop-blur-xl",
                            align === "right" ? "right-0" : "left-0",
                            className
                        )}
                    >
                        <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
                            {children}
                        </DropdownContext.Provider>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

import { createContext, useContext } from "react";
const DropdownContext = createContext({ close: () => {} });

export function DropdownItem({ children, icon, onClick, className, danger, closeOnClick = true }) {
    const { close } = useContext(DropdownContext);
    return (
        <button
            role="menuitem"
            onClick={(e) => {
                onClick?.(e);
                if (closeOnClick) close();
            }}
            className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                danger ? "text-rose-300 hover:bg-rose-500/10" : "text-white/85 hover:bg-white/10 hover:text-white",
                className
            )}
        >
            {icon && <span className="text-current opacity-80">{icon}</span>}
            <span className="flex-1">{children}</span>
        </button>
    );
}

export function DropdownSeparator() {
    return <div className="my-1 h-px bg-white/10" />;
}

export function DropdownLabel({ children }) {
    return <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{children}</div>;
}
