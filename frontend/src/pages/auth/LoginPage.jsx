import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Lock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { loginSchema } from "@/features/auth/schemas";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { PATHS } from "@/routes/paths";

export default function LoginPage() {
    const { login } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();
    const [submitting, setSubmitting] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm({ resolver: zodResolver(loginSchema) });

    const onSubmit = async (values) => {
        setSubmitting(true);
        try {
            const payload = values.identifier.includes("@")
                ? { email: values.identifier, password: values.password }
                : { username: values.identifier, password: values.password };
            const u = await login(payload);
            toast.success(`Welcome back${u?.fullName ? `, ${u.fullName.split(" ")[0]}` : ""}!`);
            navigate(location.state?.from || PATHS.home, { replace: true });
        } catch (e) {
            toast.error(extractErrorMessage(e, "Login failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            <div className="mb-6">
                <h2 className="font-display text-2xl font-semibold text-white">Sign in</h2>
                <p className="mt-1 text-sm text-muted">
                    New to AnimeVerse?{" "}
                    <Link className="text-accent hover:underline" to={PATHS.register}>
                        Create an account
                    </Link>
                </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <Input
                    label="Email or username"
                    placeholder="you@example.com"
                    leftIcon={<Mail className="h-4 w-4" />}
                    autoComplete="username"
                    error={errors.identifier?.message}
                    {...register("identifier")}
                />
                <Input
                    label="Password"
                    type="password"
                    placeholder="--------"
                    leftIcon={<Lock className="h-4 w-4" />}
                    autoComplete="current-password"
                    error={errors.password?.message}
                    {...register("password")}
                />

                <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.06] accent-primary"
                        />
                        Remember me
                    </label>
                    <Link
                        to={PATHS.forgotPassword}
                        className="text-xs text-accent hover:underline"
                    >
                        Forgot password?
                    </Link>
                </div>

                <Button type="submit" variant="primary" fullWidth loading={submitting}>
                    Sign in
                </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted">
                <div className="h-px flex-1 bg-white/10" />
                or continue with
                <div className="h-px flex-1 bg-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" disabled>Google</Button>
                <Button variant="ghost" disabled>Discord</Button>
            </div>
        </div>
    );
}
