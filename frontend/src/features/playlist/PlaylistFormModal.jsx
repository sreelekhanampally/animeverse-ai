import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { useCreatePlaylist, useUpdatePlaylist } from "./hooks";

export function PlaylistFormModal({ open, onClose, playlist }) {
    const isEdit = !!playlist;
    const toast = useToast();
    const create = useCreatePlaylist();
    const update = useUpdatePlaylist();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [isPublic, setIsPublic] = useState(true);
    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (open) {
            setName(playlist?.name || "");
            setDescription(playlist?.description || "");
            setIsPublic(playlist?.isPublic !== false);
            setErrors({});
        }
    }, [open, playlist]);

    const submit = async (e) => {
        e.preventDefault();
        const nextErrors = {};
        if (!name.trim()) nextErrors.name = "Name is required";
        else if (name.trim().length > 80) nextErrors.name = "Max 80 characters";
        if (description.trim().length > 500) nextErrors.description = "Max 500 characters";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;

        const payload = { name: name.trim(), description: description.trim(), isPublic };
        try {
            if (isEdit) {
                await update.mutateAsync({ id: playlist._id, payload });
                toast.success("Playlist updated");
            } else {
                await create.mutateAsync(payload);
                toast.success("Playlist created");
            }
            onClose?.();
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't save playlist"));
        }
    };

    const pending = create.isPending || update.isPending;

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title={isEdit ? "Rename playlist" : "Create playlist"}
            description={isEdit ? "Update the details of your playlist." : "Group videos into a curated collection."}
        >
            <form onSubmit={submit} className="space-y-4">
                <Input
                    label="Name"
                    placeholder="Shonen Essentials"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    error={errors.name}
                    maxLength={80}
                    autoFocus
                />
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/80">Description</label>
                    <textarea
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What is this playlist about?"
                        className="input-base resize-none"
                    />
                    {errors.description && (
                        <p className="text-xs text-rose-400">{errors.description}</p>
                    )}
                </div>
                <label className="flex items-center gap-2 text-sm text-white/85">
                    <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 bg-white/[0.06] accent-primary"
                        checked={isPublic}
                        onChange={(e) => setIsPublic(e.target.checked)}
                    />
                    Make this playlist public
                </label>
                <div className="flex justify-end gap-2 pt-2">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onClose}
                        disabled={pending}
                    >
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={pending}>
                        {isEdit ? "Save changes" : "Create playlist"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}