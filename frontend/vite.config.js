import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:8000",
                changeOrigin: true,
                secure: false,
            },
        },
    },
    preview: {
        host: "0.0.0.0",
        port: 5173,
    },
    build: {
        target: "es2020",
        sourcemap: false,
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ["react", "react-dom", "react-router-dom"],
                    motion: ["framer-motion"],
                    forms: ["react-hook-form", "@hookform/resolvers", "zod"],
                    query: ["@tanstack/react-query"],
                },
            },
        },
    },
});
