import { useEffect, useRef, useState } from "react";
import {
    Play,
    Pause,
    Volume2,
    VolumeX,
    Maximize2,
    Loader2,
    AlertCircle,
    Settings,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { formatDuration } from "@/utils/format";

/**
 * A YouTube ID is 11 chars of [A-Za-z0-9_-]. Validating before building the URL
 * keeps a malformed/empty value from producing an iframe that renders YouTube's
 * own error screen inside our player chrome, and stops anything user-supplied
 * from being interpolated into the embed URL.
 */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const isValidYouTubeId = (id) =>
    typeof id === "string" && YOUTUBE_ID_RE.test(id.trim());

/**
 * Official YouTube embed (youtube-nocookie for privacy). The ID is encoded and
 * the video is *streamed by YouTube* — never downloaded, proxied or re-hosted.
 */
export const buildYouTubeEmbedUrl = (id) =>
    `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
        String(id).trim()
    )}?rel=0&modestbranding=1&playsinline=1`;

/**
 * Renders the YouTube-hosted case. This is deliberately a separate branch from
 * the HTML5 path below: an <iframe> exposes no currentTime/buffered/volume to
 * this origin, so the custom control bar cannot drive it. Re-using that bar would
 * mean shipping controls that silently do nothing. YouTube's own controls are
 * used instead, which is also what the embed terms expect.
 */
function YouTubeEmbed({ externalVideoId, title, className }) {
    const valid = isValidYouTubeId(externalVideoId);

    return (
        <div
            className={cn(
                "relative aspect-video w-full overflow-hidden rounded-2xl border border-white/5 bg-black shadow-2xl",
                className
            )}
        >
            {valid ? (
                <iframe
                    key={externalVideoId}
                    src={buildYouTubeEmbedUrl(externalVideoId)}
                    title={title || "YouTube video player"}
                    className="absolute inset-0 h-full w-full"
                    // Standard YouTube embed permissions; no autoplay.
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    loading="lazy"
                />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-white">
                    <AlertCircle className="h-8 w-8 text-rose-400" />
                    <div className="text-sm">This video is unavailable.</div>
                    <div className="text-xs text-muted">
                        The external video reference is missing or invalid.
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Source-aware entry point. Kept as a thin dispatcher on purpose: the HTML5 path
 * below owns ~10 hooks, so branching *inside* one component would change the hook
 * order whenever a user navigated from a Cloudinary video to a YouTube one (the
 * element position on WatchPage is reused across route params). Splitting the two
 * branches into separate components makes that transition an unmount/mount and
 * keeps each branch's hooks stable.
 *
 * Anything that isn't explicitly "youtube" — including a legacy document — falls
 * through to the original HTML5 player, unchanged.
 */
export function VideoPlayer({ sourceType = "cloudinary", externalVideoId, title, ...rest }) {
    if (sourceType === "youtube") {
        return (
            <YouTubeEmbed
                externalVideoId={externalVideoId}
                title={title}
                className={rest.className}
            />
        );
    }
    return <Html5VideoPlayer {...rest} />;
}

function Html5VideoPlayer({ src, poster, onEnded, onProgress, className }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [buffered, setBuffered] = useState(0);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const hideTimer = useRef(null);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onTime = () => {
            setCurrent(v.currentTime);
            if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
            if (v.duration) onProgress?.(v.currentTime, v.duration);
        };
        const onMeta = () => setDuration(v.duration || 0);
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        const onWait = () => setWaiting(true);
        const onCanPlay = () => setWaiting(false);
        const onErr = () => setError(true);
        const onEnd = () => onEnded?.();
        v.addEventListener("timeupdate", onTime);
        v.addEventListener("loadedmetadata", onMeta);
        v.addEventListener("play", onPlay);
        v.addEventListener("pause", onPause);
        v.addEventListener("waiting", onWait);
        v.addEventListener("canplay", onCanPlay);
        v.addEventListener("error", onErr);
        v.addEventListener("ended", onEnd);
        return () => {
            v.removeEventListener("timeupdate", onTime);
            v.removeEventListener("loadedmetadata", onMeta);
            v.removeEventListener("play", onPlay);
            v.removeEventListener("pause", onPause);
            v.removeEventListener("waiting", onWait);
            v.removeEventListener("canplay", onCanPlay);
            v.removeEventListener("error", onErr);
            v.removeEventListener("ended", onEnd);
        };
    }, [onEnded, onProgress]);

    useEffect(() => {
        setError(false);
        setCurrent(0);
        setBuffered(0);
    }, [src]);

    const togglePlay = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) v.play();
        else v.pause();
    };

    const toggleMute = () => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    };

    const seek = (t) => {
        const v = videoRef.current;
        if (!v || !v.duration) return;
        v.currentTime = t;
        setCurrent(t);
    };

    const onSeekChange = (e) => {
        const pct = Number(e.target.value);
        seek((duration || 0) * (pct / 100));
    };

    const onVolumeChange = (e) => {
        const v = videoRef.current;
        const val = Number(e.target.value);
        setVolume(val);
        if (v) {
            v.volume = val;
            v.muted = val === 0;
            setMuted(val === 0);
        }
    };

    const enterFullscreen = () => {
        const el = containerRef.current;
        if (!el) return;
        if (document.fullscreenElement) document.exitFullscreen?.();
        else el.requestFullscreen?.();
    };

    const nudgeControls = () => {
        setShowControls(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => playing && setShowControls(false), 2400);
    };

    useEffect(() => () => clearTimeout(hideTimer.current), []);

    const pct = duration ? (current / duration) * 100 : 0;
    const bufPct = duration ? (buffered / duration) * 100 : 0;

    return (
        <div
            ref={containerRef}
            onMouseMove={nudgeControls}
            onMouseLeave={() => playing && setShowControls(false)}
            className={cn(
                "group relative aspect-video w-full overflow-hidden rounded-2xl border border-white/5 bg-black shadow-2xl",
                className
            )}
        >
            {src ? (
                <video
                    ref={videoRef}
                    src={src}
                    poster={poster}
                    className="h-full w-full object-contain"
                    playsInline
                    onClick={togglePlay}
                    onDoubleClick={enterFullscreen}
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted">
                    No video source
                </div>
            )}

            {waiting && !error && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <Loader2 className="h-10 w-10 animate-spin text-white/80" />
                </div>
            )}

            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
                    <AlertCircle className="h-8 w-8 text-rose-400" />
                    <div className="text-sm">This video failed to load.</div>
                </div>
            )}

            {/* Center play indicator when paused */}
            {!playing && !waiting && !error && src && (
                <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center"
                    aria-label="Play"
                >
                    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/85 shadow-glow transition group-hover:scale-105">
                        <Play className="ml-1 h-8 w-8 text-white" fill="currentColor" />
                    </span>
                </button>
            )}

            {/* Controls */}
            <div
                className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/85 via-black/30 to-transparent px-3 pb-3 pt-8 transition-opacity duration-200",
                    showControls || !playing ? "opacity-100" : "opacity-0",
                    src ? "pointer-events-auto" : ""
                )}
            >
                <div className="relative">
                    <div className="absolute inset-0 h-1 rounded-full bg-white/15" />
                    <div
                        className="absolute h-1 rounded-full bg-white/30"
                        style={{ width: `${bufPct}%` }}
                    />
                    <div
                        className="absolute h-1 rounded-full bg-gradient-to-r from-primary to-accent"
                        style={{ width: `${pct}%` }}
                    />
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.1}
                        value={pct}
                        onChange={onSeekChange}
                        className="relative h-1 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                        aria-label="Seek"
                    />
                </div>

                <div className="flex items-center gap-3 text-white">
                    <button
                        onClick={togglePlay}
                        className="rounded-lg p-1.5 transition hover:bg-white/10"
                        aria-label={playing ? "Pause" : "Play"}
                    >
                        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleMute}
                            className="rounded-lg p-1.5 transition hover:bg-white/10"
                            aria-label={muted ? "Unmute" : "Mute"}
                        >
                            {muted || volume === 0 ? (
                                <VolumeX className="h-5 w-5" />
                            ) : (
                                <Volume2 className="h-5 w-5" />
                            )}
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={muted ? 0 : volume}
                            onChange={onVolumeChange}
                            className="hidden w-20 cursor-pointer accent-primary sm:block"
                            aria-label="Volume"
                        />
                    </div>

                    <div className="ml-1 text-xs text-white/85">
                        {formatDuration(current)} / {formatDuration(duration)}
                    </div>

                    <div className="ml-auto flex items-center gap-1">
                        <button
                            className="rounded-lg p-1.5 transition hover:bg-white/10"
                            aria-label="Settings"
                            title="Playback settings"
                        >
                            <Settings className="h-5 w-5" />
                        </button>
                        <button
                            onClick={enterFullscreen}
                            className="rounded-lg p-1.5 transition hover:bg-white/10"
                            aria-label="Fullscreen"
                        >
                            <Maximize2 className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function VideoPlayerSkeleton({ className }) {
    return (
        <div className={cn("aspect-video w-full overflow-hidden rounded-2xl", className)}>
            <div className="skeleton h-full w-full" />
        </div>
    );
}