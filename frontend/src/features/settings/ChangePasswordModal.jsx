import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { tokenStore } from "@/utils/token";
import { useChangePassword } from "./hooks";

// registerUser enforces a 6-character minimum; the same floor is applied here so
// a password set at registration can always be re-saved.
const PASSWORD_MIN = 6;

export function ChangePasswordModal({ open, onClose }) {
    const toast = useToast();
    const change = useChangePassword();
    const submittingRef = useRef(false);

    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confPassword, setConfPassword] = useState("");
    const [errors, setErrors] = useState({});

    // Never keep plaintext passwords in state longer than the modal is open.
    useEffect(() => {
        if (open) return;
        setOldPassword("");
        setNewPassword("");
        setConfPassword("");
        setErrors({});
    }, [open]);

    const pending = change.isPending;

    const submit = async (e) => {
        e.preventDefault();
        if (pending || submittingRef.current) return;

        const next = {};
        if (!oldPassword) next.oldPassword = "Enter your current password";
        if (!newPassword) next.newPassword = "Enter a new password";
        else if (newPassword.length < PASSWORD_MIN)
            next.newPassword = `At least ${PASSWORD_MIN} characters`;
        else if (newPassword === oldPassword)
            next.newPassword = "New password must be different from the current one";
        if (!confPassword) next.confPassword = "Confirm your new password";
        else if (confPassword !== newPassword) next.confPassword = "Passwords do not match";

        setErrors(next);
        if (Object.keys(next).length) return;

        submittingRef.current = true;
        try {
            // The backend rotates the refresh token on success and returns a fresh
            // access token. Storing it keeps this tab authenticated — without it the
            // next request would 401 and bounce the user to the login screen.
            const data = await change.mutateAsync({
                oldPassword,
                newPassword,
                confPassword,
            });
            if (data?.accessToken) tokenStore.set(data.accessToken);

            toast.success("Password changed. Other sessions were signed out.");
            onClose?.();
        } catch (err) {
            const message = extractErrorMessage(err, "Couldn't change your password");
            // "Invalid old password" is the common case and belongs on the field.
            if (/old password/i.test(message)) {
                setErrors((p) => ({ ...p, oldPassword: message }));
            }
            toast.error(message);
        } finally {
            submittingRef.current = false;
        }
    };

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title="Change password"
            description="You'll stay signed in here. Any other session is signed out."
            size="sm"
        >
            <form onSubmit={submit} className="space-y-4">
                {/* autoComplete hints stop password managers filling the wrong box. */}
                <Input
                    label="Current password"
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(e) => {
                        setOldPassword(e.target.value);
                        if (errors.oldPassword)
                            setErrors((p) => ({ ...p, oldPassword: undefined }));
                    }}
                    error={errors.oldPassword}
                    disabled={pending}
                />
                <Input
                    label="New password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (errors.newPassword)
                            setErrors((p) => ({ ...p, newPassword: undefined }));
                    }}
                    error={errors.newPassword}
                    hint={`At least ${PASSWORD_MIN} characters`}
                    disabled={pending}
                />
                <Input
                    label="Confirm new password"
                    type="password"
                    autoComplete="new-password"
                    value={confPassword}
                    onChange={(e) => {
                        setConfPassword(e.target.value);
                        if (errors.confPassword)
                            setErrors((p) => ({ ...p, confPassword: undefined }));
                    }}
                    error={errors.confPassword}
                    disabled={pending}
                />

                <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={pending}>
                        Update password
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
