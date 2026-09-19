import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ApiError } from "./utils/ApiError.js";
import { requestContext } from "./middlewares/requestContext.middleware.js";
import { requestTimeout } from "./middlewares/requestTimeout.middleware.js";
import { errorHandler, notFound } from "./middlewares/error.middleware.js";

// Routes
import userRouter from "./routes/user.routes.js";
import healthcheckRouter from "./routes/healthcheck.routes.js";
import tweetRouter from "./routes/tweet.routes.js";
import subscriptionRouter from "./routes/subscription.routes.js";
import videoRouter from "./routes/video.routes.js";
import commentRouter from "./routes/comment.routes.js";
import likeRouter from "./routes/like.routes.js";
import playlistRouter from "./routes/playlist.routes.js";
import dashboardRouter from "./routes/dashboard.routes.js";
import aiRouter from "./routes/ai.routes.js";
import communityRouter from "./routes/community.routes.js";
import statsRouter from "./routes/stats.routes.js";

const app = express();

const trustProxyValue = () => {
    const configured = String(process.env.TRUST_PROXY || "").trim();
    if (!configured) return process.env.NODE_ENV === "production" ? 1 : false;
    if (configured === "true") return 1;
    if (configured === "false") return false;
    const numeric = Number(configured);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : configured;
};

app.set("trust proxy", trustProxyValue());
app.disable("x-powered-by");

// Establish a request ID and deadline before any middleware that can reject.
app.use(requestContext);
app.use(requestTimeout);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigins = (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new ApiError(403, "Origin not allowed by CORS", [], "", "CORS_DENIED"));
        },
        credentials: true,
        exposedHeaders: ["X-Request-ID"],
    })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static("public"));
app.use(cookieParser());

// Health probes are intentionally outside the global rate limiter so an orchestrator
// can always decide whether this instance should receive traffic.
app.use("/api/v1/healthcheck", healthcheckRouter);

const limiterHandler = (req, res, next) =>
    next(new ApiError(429, "Too many requests. Please try again later.", [], "", "RATE_LIMITED"));

app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        handler: limiterHandler,
    })
);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: limiterHandler,
});

app.use("/api/v1/users/login", authLimiter);
app.use("/api/v1/users/register", authLimiter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/tweets", tweetRouter);
app.use("/api/v1/subscriptions", subscriptionRouter);
app.use("/api/v1/videos", videoRouter);
app.use("/api/v1/comments", commentRouter);
app.use("/api/v1/likes", likeRouter);
app.use("/api/v1/playlist", playlistRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/ai", aiRouter);
app.use("/api/v1/community", communityRouter);
app.use("/api/v1/stats", statsRouter);

app.use(notFound);
app.use(errorHandler);

export { app };
