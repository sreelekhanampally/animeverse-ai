import { z } from "zod";

export const loginSchema = z.object({
    identifier: z
        .string()
        .min(1, "Email or username is required")
        .max(120, "That's too long"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z
    .object({
        fullName: z.string().min(2, "Please tell us your name").max(80, "That's too long"),
        username: z
            .string()
            .min(3, "At least 3 characters")
            .max(24, "Max 24 characters")
            .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dot, dash and underscore only"),
        email: z.string().email("Enter a valid email"),
        password: z
            .string()
            .min(8, "At least 8 characters")
            .regex(/[A-Z]/, "Include one uppercase letter")
            .regex(/[0-9]/, "Include one number"),
        confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
        path: ["confirmPassword"],
        message: "Passwords don't match",
    });

export const forgotPasswordSchema = z.object({
    email: z.string().email("Enter a valid email"),
});

export const resetPasswordSchema = z
    .object({
        token: z.string().min(1, "Reset token required"),
        password: z
            .string()
            .min(8, "At least 8 characters")
            .regex(/[A-Z]/, "Include one uppercase letter")
            .regex(/[0-9]/, "Include one number"),
        confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
        path: ["confirmPassword"],
        message: "Passwords don't match",
    });
