import { useEffect, useState } from "react";

export function useMediaQuery(query) {
    const get = () =>
        typeof window !== "undefined" && window.matchMedia
            ? window.matchMedia(query).matches
            : false;
    const [matches, setMatches] = useState(get);

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia(query);
        const handler = (e) => setMatches(e.matches);
        setMatches(mql.matches);
        mql.addEventListener?.("change", handler);
        return () => mql.removeEventListener?.("change", handler);
    }, [query]);

    return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
export const useIsTablet = () => useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
