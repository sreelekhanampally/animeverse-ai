import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { useUpdateVideo } from "./hooks";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 200 * 1024 * 1024; // matches backend multer limit
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 5000;

export function EditVideoModal({ open, onClose, video }) {
    const toast = useToast();
    const update = useUpdateVideo();
    const fileRef = useRef(null);
    const submittingRef = useRef(false);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [thumbnail, setThumbnail] = useState(null);
    const [preview, setPreview] = useState(null);
    const [errors, setErrors] = useState({});

    // Re-seed the form whenever a different video is opened.
    useEffect(() => {
        if (!open) return;
        setTitle(video?.title || "");
        setDescription(video?.description || "");
        setThumbnail(null);
        setErrors({});
    }, [open, video]);

    useEffect(() => {
        if (!thumbnail) return setPreview(null);
        const url = URL.createObjectURL(thumbnail);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [thumbnail]);

    const pickThumbnail = (file) => {
        if (!file) {
            setThumbnail(null);
            setErrors((p) => ({ ...p, thumbnail: undefined }));
            return;
        }
        let error;
        if (file.size > MAX_BYTES) error = "Thumbnail is too large (max 200 MB).";
        else if (file.type && !IMAGE_MIMES.includes(file.type))
            error = "Unsupported image format. Allowed: jpeg, png, webp, gif.";
        setThumbnail(file);
        setErrors((p) => ({ ...p, thumbnail: error }));
    };

    const submit = async (e) => {
        e.preventDefault();
        // `isPending` is state and lands a render later, so a fast double-submit
        // could fire two PATCHes. The ref flips synchronously.
        if (update.isPending || submittingRef.current) return;

        const next = {};
        if (!title.trim()) next.title = "Title is required";
        else if (title.trim().length > TITLE_MAX) next.title = `Max ${TITLE_MAX} characters`;
        if (!description.trim()) next.description = "Description is required";
        else if (description.trim().length > DESCRIPTION_MAX)
            next.description = `Max ${DESCRIPTION_MAX} characters`;
        if (errors.thumbnail) next.thumbnail = errors.thumbnail;
        setErrors(next);
        if (Object.keys(next).length) return;

        // Always send title/description so unchanged values are preserved.
        // The backend only overwrites a field when it's a non-empty string.
        const formData = new FormData();
        formData.append("title", title.trim());
        formData.append("description", description.trim());
        // Field name must be "thumbnail" — backend uses upload.single("thumbnail").
        if (thumbnail) formData.append("thumbnail", thumbnail);

        submittingRef.current = true;
        try {
            await update.mutateAsync({ id: video._id, formData });
            toast.success("Video updated");
            onClose?.();
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't update this video"));
        } finally {
            submittingRef.current = false;
        }
    };

    const pending = update.isPending;
    const currentThumb = preview || video?.thumbnail;

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title="Edit video"
            description="Update the title, description, or thumbnail."
        >
            <form onSubmit={submit} className="space-y-4">
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-white/80">Thumbnail</span>
                    <div className="flex items-center gap-3">
                        {currentThumb ? (
                            <img
                                src={currentThumb}
                                alt="Thumbnail"
                                className="h-16 w-28 shrink-0 rounded-xl border border-white/10 object-cover"
                            />
                        ) : (
                            <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-muted">
                                <ImageIcon className="h-4 w-4" />
                            </div>
                        )}
                        <div className="min-w-0 flex-1">
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                className="sr-only"
                                disabled={pending}
                                onChange={(e) => {
                                    pickThumbnail(e.target.files?.[0] || null);
                                    e.target.value = "";
                                }}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={pending}
                                    onClick={() => fileRef.current?.click()}
                                >
                                    {thumbnail ? "Choose another" : "Replace thumbnail"}
                                </Button>
                                {thumbnail && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="iconSm"
                                        aria-label="Discard new thumbnail"
                                        disabled={pending}
                                        onClick={() => pickThumbnail(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted">
                                {thumbnail ? thumbnail.name : "Leave empty to keep the current one"}
                            </p>
                        </div>
                    </div>
                    {errors.thumbnail && (
                        <p className="text-xs text-rose-400">{errors.thumbnail}</p>
                    )}
                </div>

                <Input
                    label="Title"
                    value={title}
                    onChange={(e) => {
                        setTitle(e.target.value);
                        if (errors.title) setErrors((p) => ({ ...p, title: undefined }));
                    }}
                    error={errors.title}
                    maxLength={TITLE_MAX}
                    disabled={pending}
                />

                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="edit-description"
                        className="text-xs font-medium text-white/80"
                    >
                        Description
                    </label>
                    <textarea
                        id="edit-description"
                        rows={4}
                        value={description}
                        onChange={(e) => {
                            setDescription(e.target.value);
                            if (errors.description)
                                setErrors((p) => ({ ...p, description: undefined }));
                        }}
                        maxLength={DESCRIPTION_MAX}
                        disabled={pending}
                        className={`input-base resize-y ${
                            errors.description ? "border-rose-500/60" : ""
                        }`}
                    />
                    {errors.description && (
                        <p className="text-xs text-rose-400">{errors.description}</p>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={pending}>
                        Save changes
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
