/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,jsx}"],
    theme: {
        extend: {
            colors: {
                bg: "#0F172A",
                card: "#1E293B",
                primary: {
                    DEFAULT: "#7C3AED",
                    50: "#F5F3FF",
                    500: "#7C3AED",
                    600: "#6D28D9",
                    700: "#5B21B6",
                },
                accent: {
                    DEFAULT: "#06B6D4",
                    500: "#06B6D4",
                    600: "#0891B2",
                },
                muted: "#94A3B8",
            },
            fontFamily: {
                sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
                display: ["'Space Grotesk'", "Inter", "sans-serif"],
            },
            boxShadow: {
                glow: "0 0 32px rgba(124, 58, 237, 0.35)",
                accent: "0 0 24px rgba(6, 182, 212, 0.35)",
            },
            animation: {
                "gradient-x": "gradient-x 8s ease infinite",
                float: "float 6s ease-in-out infinite",
            },
            keyframes: {
                "gradient-x": {
                    "0%, 100%": { backgroundPosition: "0% 50%" },
                    "50%": { backgroundPosition: "100% 50%" },
                },
                float: {
                    "0%, 100%": { transform: "translateY(0)" },
                    "50%": { transform: "translateY(-10px)" },
                },
            },
        },
    },
    plugins: [],
};
