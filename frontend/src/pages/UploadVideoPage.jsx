import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
    Upload,
    Film,
    Image as ImageIcon,
    X,
    Loader2,
    Sparkles,
} from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/contexts/ToastContext";
import { videoService, extractErrorMessage } from "@/services";
import { unwrapData } from "@/utils/unwrap";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Kept in sync with the backend multer config
 * (backend/src/middlewares/multer.middleware.js), so the user gets a useful
 * message client-side instead of a generic 500 from the server.
 */
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 200 * 1024 * 1024; // multer limit: 200MB

const CATEGORIES = [
    "General",
    "Action",
    "Romance",
    "Comedy",
    "Fantasy",
    "Adventure",
    "Emotional",
    "Other",
];

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 5000;

function formatBytes(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error string, or null when the file is acceptable. */
function validateFile(file, { mimes, label, max = MAX_BYTES }) {
    if (!file) return `${label} is required`;
    if (file.size > max) {
        return `${label} is too large (${formatBytes(file.size)}). Max ${formatBytes(max)}.`;
    }
    // Some browsers report an empty type for uncommon containers; fall back to
    // the extension rather than rejecting a file the server would accept.
    if (file.type && !mimes.includes(file.type)) {
        return `Unsupported ${label.toLowerCase()} format. Allowed: ${mimes
            .map((m) => m.split("/")[1])
            .join(", ")}.`;
    }
    return null;
}

function FileField({
    id,
    label,
    hint,
    icon: Icon,
    accept,
    file,
    error,
    disabled,
    onPick,
    onClear,
    children,
}) {
    const inputRef = useRef(null);

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-white/80">{label}</span>

            <input
                ref={inputRef}
                id={id}
                name={id}
                type="file"
                accept={accept}
                disabled={disabled}
                className="sr-only"
                onChange={(e) => {
                    onPick(e.target.files?.[0] || null);
                    // Allow re-selecting the same file after a clear.
                    e.target.value = "";
                }}
            />

            {file ? (
                <div
                    className={`card-base p-3 ${error ? "border-rose-500/50" : "border-white/10"}`}
                >
                    {children}
                    <div className="mt-3 flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/25 text-white">
                            <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-white" title={file.name}>
                                {file.name}
                            </div>
                            <div className="text-xs text-muted">{formatBytes(file.size)}</div>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => inputRef.current?.click()}
                        >
                            Change
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="iconSm"
                            aria-label={`Remove ${label.toLowerCase()}`}
                            disabled={disabled}
                            onClick={onClear}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => inputRef.current?.click()}
                    className={`group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-center transition disabled:pointer-events-none disabled:opacity-60 ${
                        error
                            ? "border-rose-500/50 bg-rose-500/[0.04]"
                            : "border-white/15 bg-white/[0.02] hover:border-primary/50 hover:bg-white/[0.04]"
                    }`}
                >
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-accent/25 text-white transition group-hover:scale-105">
                        <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-medium text-white">Choose {label.toLowerCase()}</span>
                    {hint && <span className="max-w-xs text-xs text-muted">{hint}</span>}
                </button>
            )}

            {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
    );
}

export default function UploadVideoPage() {
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();

    const [videoFile, setVideoFile] = useState(null);
    const [thumbnail, setThumbnail] = useState(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [tags, setTags] = useState([]);
    const [category, setCategory] = useState(CATEGORIES[0]);

    const [errors, setErrors] = useState({});
    const [uploading, setUploading] = useState(false);

    // Object URLs for previews, revoked on change/unmount to avoid leaks.
    const [videoPreview, setVideoPreview] = useState(null);
    const [thumbPreview, setThumbPreview] = useState(null);

    useEffect(() => {
        if (!videoFile) return setVideoPreview(null);
        const url = URL.createObjectURL(videoFile);
        setVideoPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [videoFile]);

    useEffect(() => {
        if (!thumbnail) return setThumbPreview(null);
        const url = URL.createObjectURL(thumbnail);
        setThumbPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [thumbnail]);

    /** Clears a field error as soon as the user starts correcting it. */
    const clearError = (field) =>
        setErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });

    const addTag = (raw) => {
        const cleaned = raw.trim().replace(/^#/, "").toLowerCase();
        if (!cleaned) return;
        if (tags.length >= 10) {
            toast.info("You can add up to 10 tags");
            setTagInput("");
            return;
        }
        if (!tags.includes(cleaned)) setTags((t) => [...t, cleaned]);
        setTagInput("");
    };

    const onTagKeyDown = (e) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(tagInput);
        } else if (e.key === "Backspace" && !tagInput && tags.length) {
            setTags((t) => t.slice(0, -1));
        }
    };

    const pickVideo = (file) => {
        setVideoFile(file);
        setErrors((prev) => ({
            ...prev,
            videoFile: file ? validateFile(file, { mimes: VIDEO_MIMES, label: "Video" }) : undefined,
        }));
    };

    const pickThumbnail = (file) => {
        setThumbnail(file);
        setErrors((prev) => ({
            ...prev,
            thumbnail: file
                ? validateFile(file, { mimes: IMAGE_MIMES, label: "Thumbnail" })
                : undefined,
        }));
    };

    const validate = () => {
        const next = {};

        const videoError = validateFile(videoFile, { mimes: VIDEO_MIMES, label: "Video" });
        if (videoError) next.videoFile = videoError;

        const thumbError = validateFile(thumbnail, { mimes: IMAGE_MIMES, label: "Thumbnail" });
        if (thumbError) next.thumbnail = thumbError;

        if (!title.trim()) next.title = "Title is required";
        else if (title.trim().length > TITLE_MAX) next.title = `Max ${TITLE_MAX} characters`;

        if (!description.trim()) next.description = "Description is required";
        else if (description.trim().length > DESCRIPTION_MAX)
            next.description = `Max ${DESCRIPTION_MAX} characters`;

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (uploading) return; // guard against duplicate submissions
        if (!validate()) {
            toast.error("Please fix the highlighted fields");
            return;
        }

        // Field names must match the backend multer fields: videoFile, thumbnail.
        const formData = new FormData();
        formData.append("videoFile", videoFile);
        formData.append("thumbnail", thumbnail);
        formData.append("title", title.trim());
        formData.append("description", description.trim());
        // Sent for forward-compatibility; the current controller ignores these.
        formData.append("category", category);
        tags.forEach((tag) => formData.append("tags", tag));

        setUploading(true);
        try {
            // Reuses the existing service function as-is. Axios strips the
            // manual Content-Type for FormData in the browser, so the multipart
            // boundary is generated automatically.
            const response = await videoService.publish(formData);

            const created = unwrapData(response);
            const videoId = created?._id;

            toast.success("Video published successfully");
            queryClient.invalidateQueries({ queryKey: ["videos"] });

            if (videoId) {
                navigate(`/watch/${videoId}`);
            } else {
                // Published, but the id wasn't in the response — don't pretend it failed.
                toast.info("Uploaded, but couldn't open the video page automatically");
            }
        } catch (err) {
            // Files and metadata are intentionally preserved so the user can retry.
            toast.error(extractErrorMessage(err, "Couldn't publish your video"));
            setErrors((prev) => ({
                ...prev,
                submit: extractErrorMessage(err, "Couldn't publish your video"),
            }));
        } finally {
            setUploading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
        >
            <SectionHeader
                icon={Upload}
                title="Upload Video"
                subtitle="Share your video with the AnimeVerse community."
            />

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Film className="h-4 w-4" /> Video file
                            </CardTitle>
                        </CardHeader>
                        <FileField
                            id="videoFile"
                            label="Video"
                            icon={Film}
                            accept="video/mp4,video/webm,video/quicktime"
                            hint="MP4, WebM or MOV — up to 200 MB"
                            file={videoFile}
                            error={errors.videoFile}
                            disabled={uploading}
                            onPick={pickVideo}
                            onClear={() => pickVideo(null)}
                        >
                            {videoPreview && (
                                <video
                                    src={videoPreview}
                                    controls
                                    preload="metadata"
                                    className="aspect-video w-full rounded-xl bg-black"
                                />
                            )}
                        </FileField>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ImageIcon className="h-4 w-4" /> Thumbnail
                            </CardTitle>
                        </CardHeader>
                        <FileField
                            id="thumbnail"
                            label="Thumbnail"
                            icon={ImageIcon}
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            hint="JPG, PNG, WebP or GIF — 16:9 looks best"
                            file={thumbnail}
                            error={errors.thumbnail}
                            disabled={uploading}
                            onPick={pickThumbnail}
                            onClear={() => pickThumbnail(null)}
                        >
                            {thumbPreview && (
                                <img
                                    src={thumbPreview}
                                    alt="Thumbnail preview"
                                    className="aspect-video w-full rounded-xl object-cover"
                                />
                            )}
                        </FileField>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Details</CardTitle>
                    </CardHeader>

                    <div className="space-y-4">
                        <Input
                            label="Title"
                            placeholder="Episode 1 — The Awakening"
                            value={title}
                            onChange={(e) => {
                                setTitle(e.target.value);
                                if (errors.title) clearError("title");
                            }}
                            error={errors.title}
                            hint={`${title.length}/${TITLE_MAX}`}
                            maxLength={TITLE_MAX}
                            disabled={uploading}
                        />

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="description"
                                className="text-xs font-medium text-white/80"
                            >
                                Description
                            </label>
                            <textarea
                                id="description"
                                rows={5}
                                value={description}
                                onChange={(e) => {
                                    setDescription(e.target.value);
                                    if (errors.description) clearError("description");
                                }}
                                placeholder="Tell viewers what this video is about..."
                                maxLength={DESCRIPTION_MAX}
                                disabled={uploading}
                                className={`input-base resize-y ${
                                    errors.description ? "border-rose-500/60" : ""
                                }`}
                                aria-invalid={!!errors.description || undefined}
                            />
                            {errors.description ? (
                                <p className="text-xs text-rose-400">{errors.description}</p>
                            ) : (
                                <p className="text-xs text-muted">
                                    {description.length}/{DESCRIPTION_MAX}
                                </p>
                            )}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="category"
                                    className="text-xs font-medium text-white/80"
                                >
                                    Category
                                </label>
                                <select
                                    id="category"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    disabled={uploading}
                                    className="input-base appearance-none"
                                >
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c} className="bg-card text-white">
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="tags" className="text-xs font-medium text-white/80">
                                    Tags
                                </label>
                                <input
                                    id="tags"
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={onTagKeyDown}
                                    onBlur={() => addTag(tagInput)}
                                    placeholder="shonen, fight scene..."
                                    disabled={uploading}
                                    className="input-base"
                                />
                                <p className="text-xs text-muted">
                                    Press Enter or comma to add — up to 10
                                </p>
                            </div>
                        </div>

                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {tags.map((tag) => (
                                    <span key={tag} className="chip-active">
                                        #{tag}
                                        <button
                                            type="button"
                                            disabled={uploading}
                                            onClick={() =>
                                                setTags((t) => t.filter((x) => x !== tag))
                                            }
                                            className="rounded-full p-0.5 transition hover:bg-white/20 disabled:opacity-50"
                                            aria-label={`Remove tag ${tag}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <p className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2 text-xs text-muted">
                            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                            AnimeVerse also generates tags and a summary automatically after your
                            video is published.
                        </p>
                    </div>
                </Card>

                {uploading && (
                    <Card>
                        <div className="flex items-center gap-3">
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                            <div className="min-w-0 flex-1">
                                <div className="mb-1.5 text-xs font-medium text-white">
                                    Uploading to Cloudinary — please keep this tab open
                                </div>
                                {/* Indeterminate: byte-level progress would require passing an
                                    onUploadProgress config through videoService.publish. */}
                                <div
                                    className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                                    role="progressbar"
                                    aria-label="Upload in progress"
                                >
                                    <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-primary to-accent" />
                                </div>
                                <p className="mt-1.5 text-xs text-muted">
                                    Large videos can take a while to transfer and process.
                                </p>
                            </div>
                        </div>
                    </Card>
                )}

                {errors.submit && !uploading && (
                    <p className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-200">
                        {errors.submit}
                    </p>
                )}

                <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={uploading}
                        onClick={() => navigate(-1)}
                    >
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={uploading}>
                        {uploading ? "Publishing..." : "Publish video"}
                    </Button>
                </div>
            </form>
        </motion.div>
    );
}