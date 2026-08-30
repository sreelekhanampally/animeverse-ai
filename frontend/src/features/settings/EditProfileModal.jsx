import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { useUpdateProfile } from "./hooks";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 200 * 1024 * 1024; // matches the backend multer limit

// Mirrors the backend rules in updateAccountDetails so the user gets the same
// verdict without paying for a round trip. The server still re-validates.
const USERNAME_RE = /^[a-z0-9_.-]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 24;
const FULLNAME_MAX = 60;

function validateImage(file) {
    if (!file) return undefined;
    if (file.size > MAX_BYTES) return "Image is too large (max 200 MB).";
    if (file.type && !IMAGE_MIMES.includes(file.type))
        return "Unsupported format. Allowed: jpeg, png, webp, gif.";
    return undefined;
}

/** Shared file-picker row for the avatar and cover fields. */
function ImageField({ label, hint, preview, fallback, onPick, error, disabled, hasFile, fileName }) {
    const inputRef = useRef(null);
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-white/80">{label}</span>
            <div className="flex items-center gap-3">
                {preview ? (
                    <img
                        src={preview}
                        alt={label}
                        className="h-16 w-28 shrink-0 rounded-xl border border-white/10 object-cover"
                    />
                ) : fallback ? (
                    fallback
                ) : (
                    <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-muted">
                        <ImageIcon className="h-4 w-4" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="sr-only"
                        disabled={disabled}
                        onChange={(e) => {
                            onPick(e.target.files?.[0] || null);
                            e.target.value = "";
                        }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => inputRef.current?.click()}
                        >
                            {hasFile ? "Choose another" : `Replace ${label.toLowerCase()}`}
                        </Button>
                        {hasFile && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="iconSm"
                                aria-label={`Discard new ${label.toLowerCase()}`}
                                disabled={disabled}
                                onClick={() => onPick(null)}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                        {hasFile ? fileName : hint}
                    </p>
                </div>
            </div>
            {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
    );
}

export function EditProfileModal({ open, onClose, user }) {
    const toast = useToast();
    const update = useUpdateProfile();
    const submittingRef = useRef(false);

    const [fullName, setFullName] = useState("");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [avatar, setAvatar] = useState(null);
    const [coverImage, setCoverImage] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [coverPreview, setCoverPreview] = useState(null);
    const [errors, setErrors] = useState({});

    // Re-seed from the live user every time the modal opens, so a cancelled edit
    // never leaves stale text behind.
    useEffect(() => {
        if (!open) return;
        setFullName(user?.fullName || "");
        setUsername(user?.username || "");
        setEmail(user?.email || "");
        setAvatar(null);
        setCoverImage(null);
        setErrors({});
    }, [open, user]);

    useEffect(() => {
        if (!avatar) return setAvatarPreview(null);
        const url = URL.createObjectURL(avatar);
        setAvatarPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [avatar]);

    useEffect(() => {
        if (!coverImage) return setCoverPreview(null);
        const url = URL.createObjectURL(coverImage);
        setCoverPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [coverImage]);

    const pending = update.isPending;

    const submit = async (e) => {
        e.preventDefault();
        // isPending is state and lands a render later; the ref flips synchronously
        // so a fast double-click can't fire two PATCHes.
        if (pending || submittingRef.current) return;

        const next = {};
        const trimmedName = fullName.trim();
        const trimmedEmail = email.trim();
        const normalizedUsername = username.trim().toLowerCase();

        if (!trimmedName) next.fullName = "Full name is required";
        else if (trimmedName.length > FULLNAME_MAX)
            next.fullName = `Max ${FULLNAME_MAX} characters`;

        if (!trimmedEmail) next.email = "Email is required";
        else if (!/^\S+@\S+\.\S+$/.test(trimmedEmail))
            next.email = "Enter a valid email address";

        if (!normalizedUsername) next.username = "Username is required";
        else if (normalizedUsername.length < USERNAME_MIN)
            next.username = `At least ${USERNAME_MIN} characters`;
        else if (normalizedUsername.length > USERNAME_MAX)
            next.username = `Max ${USERNAME_MAX} characters`;
        else if (!USERNAME_RE.test(normalizedUsername))
            next.username = "Only letters, numbers, dot, dash and underscore";

        const avatarError = validateImage(avatar);
        const coverError = validateImage(coverImage);
        if (avatarError) next.avatar = avatarError;
        if (coverError) next.coverImage = coverError;

        setErrors(next);
        if (Object.keys(next).length) return;

        submittingRef.current = true;
        try {
            await update.mutateAsync({
                fullName: trimmedName,
                email: trimmedEmail,
                username: normalizedUsername,
                avatar,
                coverImage,
            });
            toast.success("Profile updated");
            onClose?.();
        } catch (err) {
            const message = extractErrorMessage(err, "Couldn't update your profile");
            // 409s are always about one of these two fields; showing the message
            // inline is more useful than a toast the user has to remember.
            if (/username/i.test(message)) setErrors((p) => ({ ...p, username: message }));
            else if (/email/i.test(message)) setErrors((p) => ({ ...p, email: message }));
            toast.error(message);
        } finally {
            submittingRef.current = false;
        }
    };

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title="Edit profile"
            description="Update your name, username, email and images."
        >
            <form onSubmit={submit} className="space-y-4">
                <ImageField
                    label="Avatar"
                    hint="Leave empty to keep your current avatar"
                    preview={avatarPreview}
                    fallback={
                        <div className="shrink-0">
                            <Avatar
                                size="xl"
                                src={user?.avatar}
                                name={user?.fullName || user?.username}
                            />
                        </div>
                    }
                    hasFile={!!avatar}
                    fileName={avatar?.name}
                    error={errors.avatar}
                    disabled={pending}
                    onPick={(file) => {
                        setAvatar(file);
                        setErrors((p) => ({ ...p, avatar: validateImage(file) }));
                    }}
                />

                <ImageField
                    label="Cover image"
                    hint="Leave empty to keep your current cover"
                    preview={coverPreview || user?.coverImage || null}
                    hasFile={!!coverImage}
                    fileName={coverImage?.name}
                    error={errors.coverImage}
                    disabled={pending}
                    onPick={(file) => {
                        setCoverImage(file);
                        setErrors((p) => ({ ...p, coverImage: validateImage(file) }));
                    }}
                />

                <Input
                    label="Full name"
                    value={fullName}
                    onChange={(e) => {
                        setFullName(e.target.value);
                        if (errors.fullName) setErrors((p) => ({ ...p, fullName: undefined }));
                    }}
                    error={errors.fullName}
                    maxLength={FULLNAME_MAX}
                    disabled={pending}
                />

                <Input
                    label="Username"
                    value={username}
                    onChange={(e) => {
                        setUsername(e.target.value);
                        if (errors.username) setErrors((p) => ({ ...p, username: undefined }));
                    }}
                    error={errors.username}
                    hint="Your channel lives at /c/your-username"
                    maxLength={USERNAME_MAX}
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={pending}
                />

                <Input
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                    }}
                    error={errors.email}
                    disabled={pending}
                />

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
