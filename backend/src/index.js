import "dotenv/config";
import { app } from "./app.js";
import connectDB, { disconnectDB } from "./db/index.js";
import { assertEnvironment } from "./config/env.js";
import { markShuttingDown } from "./services/runtimeHealth.service.js";
import { logger } from "./utils/logger.js";

const positiveInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const PORT = positiveInt(process.env.PORT, 8000);
let server = null;
let shutdownPromise = null;

const configureServerTimeouts = (httpServer) => {
    httpServer.requestTimeout = positiveInt(process.env.SERVER_REQUEST_TIMEOUT_MS, 11 * 60_000);
    httpServer.headersTimeout = Math.min(
        positiveInt(process.env.SERVER_HEADERS_TIMEOUT_MS, 65_000),
        httpServer.requestTimeout
    );
    httpServer.keepAliveTimeout = positiveInt(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS, 5_000);
};

const closeHttpServer = () =>
    new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
    });

const gracefulShutdown = async (signal, exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
        markShuttingDown(signal);
        logger.warn("shutdown_started", { signal, exitCode });

        const graceMs = positiveInt(process.env.SHUTDOWN_GRACE_MS, 20_000);
        let forced = false;
        const forceTimer = setTimeout(() => {
            forced = true;
            logger.error("shutdown_forced", { signal, graceMs });
            server?.closeAllConnections?.();
        }, graceMs);
        forceTimer.unref?.();

        try {
            server?.closeIdleConnections?.();
            await Promise.race([
                closeHttpServer(),
                new Promise((resolve) => setTimeout(resolve, graceMs)),
            ]);
            await disconnectDB();
        } catch (error) {
            logger.error("shutdown_error", { signal, error });
            exitCode = 1;
        } finally {
            clearTimeout(forceTimer);
        }

        logger.info("shutdown_complete", { signal, forced, exitCode });
        process.exitCode = exitCode;
    })();

    return shutdownPromise;
};

const startServer = async () => {
    const env = assertEnvironment({ mode: "startup" });
    env.warnings.forEach((warning) => logger.warn("environment_warning", { warning }));

    await connectDB();

    server = app.listen(PORT, "0.0.0.0", () => {
        logger.info("server_started", {
            port: PORT,
            host: "0.0.0.0",
            nodeVersion: process.version,
        });
    });
    configureServerTimeouts(server);

    server.on("error", (error) => {
        logger.error("server_error", { error });
        void gracefulShutdown("server_error", 1);
    });
};

for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
        void gracefulShutdown(signal, 0);
    });
}

process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("unhandled_rejection", { error });
    void gracefulShutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
    logger.error("uncaught_exception", { error });
    void gracefulShutdown("uncaughtException", 1);
});

startServer().catch((error) => {
    logger.error("startup_failed", { error });
    process.exitCode = 1;
    void gracefulShutdown("startup_failed", 1);
});

export const serverInternals = { configureServerTimeouts, positiveInt };
