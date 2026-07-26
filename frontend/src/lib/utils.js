import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

export function formatViews(n) {
    if (!n) return "0";
    if (n < 1000) return `${n}`;
    if (n < 1e6) return `${(n / 1000).toFixed(1)}K`;
    if (n < 1e9) return `${(n / 1e6).toFixed(1)}M`;
    return `${(n / 1e9).toFixed(1)}B`;
}

export function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return "";
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function timeAgo(date) {
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = (Date.now() - d.getTime()) / 1000;
    const units = [
        [60, "s"],
        [60, "m"],
        [24, "h"],
        [30, "d"],
        [12, "mo"],
        [Infinity, "y"],
    ];
    let value = diff;
    let unit = "s";
    for (const [step, label] of units) {
        if (value < step) {
            unit = label;
            break;
        }
        value /= step;
        unit = label;
    }
    return `${Math.floor(value)}${unit} ago`;
}
