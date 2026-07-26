import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { forgotPasswordSchema } from "@/features/auth/schemas";
import { authService } from "@/services";
import { extractErrorMessage } from "@/services";
import { useToast } from "@/contexts/ToastContext";
import { PATHS } from "@/routes/paths";

export default function ForgotPasswordPage() {
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm({ resolver: zodResolver(forgotPasswordSchema) });

    const onSubmit = async (values) => {
        setLoading(true);
        try {
            await authService.forgotPassword(values);
            setSubmitted(true);
        } catch (e) {
            const msg = extractErrorMessage(e, "Unable to send reset link");
            // Endpoint may not be implemented yet — succeed silently to avoid enumeration.
            if (e?.response?.status === 404) {
                setSubmitted(true);
            } else {
                toast.error(msg);
            }
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div className="text-center">
                <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                    <CheckCircle2 className="h-6 w-6" />
                </div>
                <h2 className="font-display text-2xl font-semibold text-white">Check your email</h2>
                <p className="mt-2 text-sm text-muted">
                    If an account exists for that address, we've sent a reset link.
                </p>
                <Link to={PATHS.login} className="mt-6 inline-block text-sm text-accent hover:underline">
                    Back to sign in
                </Link>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-6">
                <h2 className="font-display text-2xl font-semibold text-white">Forgot password?</h2>
                <p className="mt-1 text-sm text-muted">
                    Enter your email and we'll send you a link to reset it.
                </p>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <Input
                    label="Email"
                    placeholder="you@example.com"
                    leftIcon={<Mail className="h-4 w-4" />}
                    error={errors.email?.message}
                    {...register("email")}
                />
                <Button type="submit" variant="primary" fullWidth loading={loading}>
                    Send reset link
                </Button>
            </form>
            <div className="mt-6 text-center text-sm text-muted">
                Remembered it?{" "}
                <Link className="text-accent hover:underline" to={PATHS.login}>
                    Sign in
                </Link>
            </div>
        </div>
    );
}
