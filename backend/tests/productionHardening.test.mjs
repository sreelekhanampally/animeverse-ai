import test from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, CircuitOpenError } from "../src/utils/circuitBreaker.js";
import { validateEnvironment } from "../src/config/env.js";
import { loggerInternals } from "../src/utils/logger.js";
import { timeoutForRequest } from "../src/middlewares/requestTimeout.middleware.js";
import { app } from "../src/app.js";
import {
    generateGeminiChat,
    geminiDiagnostics,
    resetGeminiCircuitForTests,
} from "../src/services/geminiChat.provider.js";

const validDeploymentEnv = () => ({
    NODE_ENV: "production",
    PORT: "8000",
    CORS_ORIGIN: "https://animeverse.example",
    MONGODB_URI: "mongodb+srv://user:password@example.mongodb.net",
    ACCESS_TOKEN_SECRET: "a".repeat(48),
    ACCESS_TOKEN_EXPIRY: "1d",
    REFRESH_TOKEN_SECRET: "b".repeat(48),
    REFRESH_TOKEN_EXPIRY: "10d",
    CLOUDINARY_CLOUD_NAME: "demo",
    CLOUDINARY_API_KEY: "123",
    CLOUDINARY_API_SECRET: "secret",
    EMBEDDING_PROVIDER: "local",
    ANIME_CHAT_PROVIDER: "auto",
});

test("deployment environment validation rejects unsafe production configuration", () => {
    const env = validDeploymentEnv();
    env.CORS_ORIGIN = "*";
    env.ACCESS_TOKEN_SECRET = "change-me";

    const result = validateEnvironment({ mode: "deployment", env });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.includes("CORS_ORIGIN")));
    assert.ok(result.errors.some((item) => item.includes("ACCESS_TOKEN_SECRET")));
});

test("deployment environment validation accepts core production configuration without requiring optional AI keys", () => {
    const result = validateEnvironment({ mode: "deployment", env: validDeploymentEnv() });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.features.gemini, false);
    assert.ok(result.warnings.some((item) => item.includes("GEMINI_API_KEY")));
});

test("structured logger sanitizer redacts secret fields and URI credentials", () => {
    const payload = loggerInternals.sanitize({
        authorization: "Bearer abc",
        nested: { apiKey: "secret-key", normal: "ok" },
        message: "connect mongodb+srv://user:supersecret@example.mongodb.net failed",
    });
    assert.equal(payload.authorization, "[REDACTED]");
    assert.equal(payload.nested.apiKey, "[REDACTED]");
    assert.equal(payload.nested.normal, "ok");
    assert.equal(payload.message.includes("supersecret"), false);
    assert.match(payload.message, /\[REDACTED\]/);
});

test("circuit breaker opens, rejects during cooldown, and recovers through a half-open probe", async () => {
    let now = 1_000;
    const breaker = new CircuitBreaker({
        name: "test-provider",
        failureThreshold: 2,
        cooldownMs: 1_000,
        now: () => now,
        isFailure: (error) => error.code === "UPSTREAM",
    });

    const fail = () => Promise.reject(Object.assign(new Error("down"), { code: "UPSTREAM" }));
    await assert.rejects(() => breaker.execute(fail));
    await assert.rejects(() => breaker.execute(fail));
    assert.equal(breaker.snapshot().state, "open");

    await assert.rejects(() => breaker.execute(async () => "nope"), CircuitOpenError);

    now += 1_001;
    assert.equal(await breaker.execute(async () => "ok"), "ok");
    assert.equal(breaker.snapshot().state, "closed");
    assert.equal(breaker.snapshot().failures, 0);
});


test("Gemini circuit breaker stops network calls after repeated full-provider failures", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-only-key";
    resetGeminiCircuitForTests();
    let fetchCalls = 0;
    const failingFetch = async () => {
        fetchCalls += 1;
        return {
            ok: false,
            status: 500,
            json: async () => ({ error: { message: "simulated upstream outage" } }),
        };
    };

    try {
        const threshold = geminiDiagnostics().circuit.failureThreshold;
        for (let i = 0; i < threshold; i += 1) {
            await assert.rejects(
                () => generateGeminiChat({
                    messages: [{ role: "user", content: "hello" }],
                    allowTools: false,
                    fetchImpl: failingFetch,
                }),
                (error) => error?.code === "GEMINI_UPSTREAM_ERROR"
            );
        }

        assert.equal(geminiDiagnostics().circuit.state, "open");
        const callsBeforeOpenRequest = fetchCalls;
        await assert.rejects(
            () => generateGeminiChat({
                messages: [{ role: "user", content: "hello again" }],
                allowTools: false,
                fetchImpl: failingFetch,
            }),
            (error) => error?.code === "GEMINI_CIRCUIT_OPEN"
        );
        assert.equal(fetchCalls, callsBeforeOpenRequest, "open circuit must skip outbound Gemini HTTP calls");
    } finally {
        resetGeminiCircuitForTests();
        if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalKey;
    }
});

test("request timeout policy gives uploads the longest deadline", () => {
    const original = {
        APP_REQUEST_TIMEOUT_MS: process.env.APP_REQUEST_TIMEOUT_MS,
        AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
        UPLOAD_REQUEST_TIMEOUT_MS: process.env.UPLOAD_REQUEST_TIMEOUT_MS,
    };
    process.env.APP_REQUEST_TIMEOUT_MS = "1000";
    process.env.AI_REQUEST_TIMEOUT_MS = "2000";
    process.env.UPLOAD_REQUEST_TIMEOUT_MS = "3000";

    try {
        assert.equal(timeoutForRequest({ originalUrl: "/api/v1/videos", get: () => "application/json" }), 1000);
        assert.equal(timeoutForRequest({ originalUrl: "/api/v1/ai/chat", get: () => "application/json" }), 2000);
        assert.equal(
            timeoutForRequest({ originalUrl: "/api/v1/videos", get: () => "multipart/form-data; boundary=x" }),
            3000
        );
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test("HTTP responses preserve a safe inbound request ID and return it on errors", async () => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();

    try {
        const requestId = "test-request-12345";
        const live = await fetch(`http://127.0.0.1:${port}/api/v1/healthcheck/live`, {
            headers: { "x-request-id": requestId },
        });
        assert.equal(live.status, 200);
        assert.equal(live.headers.get("x-request-id"), requestId);
        const liveBody = await live.json();
        assert.equal(liveBody.data.requestId, requestId);

        const ready = await fetch(`http://127.0.0.1:${port}/api/v1/healthcheck/ready`, {
            headers: { "x-request-id": requestId },
        });
        assert.equal(ready.status, 503);
        const readyBody = await ready.json();
        assert.equal(readyBody.data.status, "not_ready");
        assert.equal(readyBody.data.checks.database.ok, false);

        const missing = await fetch(`http://127.0.0.1:${port}/missing-route`, {
            headers: { "x-request-id": requestId },
        });
        assert.equal(missing.status, 404);
        const missingBody = await missing.json();
        assert.equal(missingBody.code, "ROUTE_NOT_FOUND");
        assert.equal(missingBody.requestId, requestId);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
