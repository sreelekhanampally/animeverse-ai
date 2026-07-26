import { useEffect } from "react";

export function useClickOutside(ref, handler, enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        const listener = (e) => {
            const el = ref.current;
            if (!el || el.contains(e.target)) return;
            handler(e);
        };
        document.addEventListener("mousedown", listener);
        document.addEventListener("touchstart", listener);
        return () => {
            document.removeEventListener("mousedown", listener);
            document.removeEventListener("touchstart", listener);
        };
    }, [ref, handler, enabled]);
}
