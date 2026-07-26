import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign, Mail, Lock, User, Camera } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { registerSchema } from "@/features/auth/schemas";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { PATHS } from "@/routes/paths";

export default function RegisterPage() {
    const { register: doRegister, login } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [avatarFile, setAvatarFile] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState(null);
    const fileRef = useRef(null);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm({ resolver: zodResolver(registerSchema) });

    const onAvatar = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setAvatarFile(f);
        setAvatarPreview(URL.createObjectURL(f));
    };

    const onSubmit = async (values) => {
        setSubmitting(true);
        try {
            const fd = new FormData();
            fd.append("fullName", values.fullName);
            fd.append("username", values.username);
            fd.append("email", values.email);
            fd.append("password", values.password);
            if (avatarFile) fd.append("avatar", avatarFile);

            await doRegister(fd);
            try {
                await login({ email: values.email, password: values.password });
            } catch {
                /* first-time login may require verification; ignore silently */
            }
            toast.success("Welcome to AnimeVerse!");
            navigate(PATHS.home, { replace: true });
        } catch (e) {
            toast.error(extractErrorMessage(e, "Registration failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            <div className="mb-6">
                <h2 className="font-display text-2xl font-semibold text-white">Create your account</h2>
                <p className="mt-1 text-sm text-muted">
                    Already a member?{" "}
                    <Link className="text-accent hover:underline" to={PATHS.login}>
                        Sign in
                    </Link>
                </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-primary/40 to-accent/40"
                    >
                        {avatarPreview ? (
                            <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center text-white/80">
                                <Camera className="h-5 w-5" />
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-semibold uppercase tracking-wider text-white opacity-0 transition group-hover:opacity-100">
                            Change
                        </div>
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={onAvatar}
                    />
                    <div className="text-xs text-muted">
                        Add an avatar (optional). PNG or JPG, up to 5MB.
                    </div>
                </div>

                <Input
                    label="Full name"
                    placeholder="Kaito Ren"
                    leftIcon={<User className="h-4 w-4" />}
                    autoComplete="name"
                    error={errors.fullName?.message}
                    {...register("fullName")}
                />
                <Input
                    label="Username"
                    placeholder="kaitoren"
                    leftIcon={<AtSign className="h-4 w-4" />}
                    autoComplete="username"
                    error={errors.username?.message}
                    {...register("username")}
                />
                <Input
                    label="Email"
                    placeholder="you@example.com"
                    leftIcon={<Mail className="h-4 w-4" />}
                    autoComplete="email"
                    error={errors.email?.message}
                    {...register("email")}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input
                        label="Password"
                        type="password"
                        placeholder="--------"
                        leftIcon={<Lock className="h-4 w-4" />}
                        autoComplete="new-password"
                        error={errors.password?.message}
                        {...register("password")}
                    />
                    <Input
                        label="Confirm"
                        type="password"
                        placeholder="--------"
                        leftIcon={<Lock className="h-4 w-4" />}
                        autoComplete="new-password"
                        error={errors.confirmPassword?.message}
                        {...register("confirmPassword")}
                    />
                </div>

                <p className="text-xs text-muted">
                    By continuing you agree to our Terms of Service and Privacy Policy.
                </p>

                <Button type="submit" variant="primary" fullWidth loading={submitting}>
                    Create account
                </Button>
            </form>
        </div>
    );
}
