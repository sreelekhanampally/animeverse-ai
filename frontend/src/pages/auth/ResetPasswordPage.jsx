import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { resetPasswordSchema } from "@/features/auth/schemas";
import { authService, extractErrorMessage } from "@/services";
import { useToast } from "@/contexts/ToastContext";
import { PATHS } from "@/routes/paths";

export default function ResetPasswordPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [loading, setLoading] = useState(false);

    const {
        register,
        handleSubmit,
        setValue,
        formState: { errors },
    } = useForm({ resolver: zodResolver(resetPasswordSchema) });

    useEffect(() => {
        const token = params.get("token");
        if (token) setValue("token", token);
    }, [params, setValue]);

    const onSubmit = async (values) => {
        setLoading(true);
        try {
            await authService.resetPassword(values);
            toast.success("Password updated. Please sign in.");
            navigate(PATHS.login, { replace: true });
        } catch (e) {
            toast.error(extractErrorMessage(e, "Unable to reset password"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="mb-6">
                <h2 className="font-display text-2xl font-semibold text-white">Reset password</h2>
                <p className="mt-1 text-sm text-muted">Choose a new password for your account.</p>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <Input
                    label="Reset token"
                    leftIcon={<KeyRound className="h-4 w-4" />}
                    error={errors.token?.message}
                    {...register("token")}
                />
                <Input
                    label="New password"
                    type="password"
                    leftIcon={<Lock className="h-4 w-4" />}
                    error={errors.password?.message}
                    {...register("password")}
                />
                <Input
                    label="Confirm new password"
                    type="password"
                    leftIcon={<Lock className="h-4 w-4" />}
                    error={errors.confirmPassword?.message}
                    {...register("confirmPassword")}
                />
                <Button type="submit" variant="primary" fullWidth loading={loading}>
                    Update password
                </Button>
            </form>
            <div className="mt-6 text-center text-sm text-muted">
                <Link className="text-accent hover:underline" to={PATHS.login}>
                    Back to sign in
                </Link>
            </div>
        </div>
    );
}
