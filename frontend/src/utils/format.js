export function formatViews(n) {
    if (n == null) return "0";
    if (n < 1000) return `${n}`;
    if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
    if (n < 1e9) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
}

export function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return "";
    const s = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function timeAgo(date) {
    if (!date) return "";
    const d = typeof date === "string" ? new Date(date) : date;
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
    return `${Math.floor(diff / 31536000)}y ago`;
}

export function initials(name = "") {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() || "")
        .join("");
}
