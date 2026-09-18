import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    calculateBenchmarkMetrics,
    EVALUATION_BENCHMARKS,
} from "../src/services/aiEvaluation.service.js";
import {
    getAiObservabilitySnapshot,
    recordAiOperation,
    resetAiObservabilityForTests,
} from "../src/services/aiObservability.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("evaluation benchmark has stable recruiter-facing queries", () => {
    assert.ok(EVALUATION_BENCHMARKS.length >= 8);
    assert.ok(EVALUATION_BENCHMARKS.every((row) => row.query && row.expected && row.aliases.length));
});

test("benchmark metrics calculate Top-1, Recall@5, MRR and latency without penalizing unavailable titles", () => {
    const metrics = calculateBenchmarkMetrics([
        { available: true, rank: 1, latencyMs: 80, error: null },
        { available: true, rank: 4, latencyMs: 100, error: null },
        { available: true, rank: null, latencyMs: 120, error: null },
        { available: false, rank: null, latencyMs: null, error: null },
    ]);

    assert.equal(metrics.eligibleQueries, 3);
    assert.equal(metrics.top1Accuracy, 33.3);
    assert.equal(metrics.recallAt5, 66.7);
    assert.equal(metrics.mrr, 0.417);
    assert.equal(metrics.p50Ms, 100);
    assert.equal(metrics.p95Ms, 120);
});

test("runtime observability records latency, success rate, provider usage and tool calls", () => {
    resetAiObservabilityForTests();
    recordAiOperation("semanticSearch", { durationMs: 10, success: true });
    recordAiOperation("semanticSearch", { durationMs: 20, success: false, errorCode: "BOOM" });
    recordAiOperation("chat", {
        durationMs: 30,
        success: true,
        provider: "gemini:test",
        toolCalls: 2,
        usedCatalog: true,
    });

    const snapshot = getAiObservabilitySnapshot();
    assert.equal(snapshot.operations.semanticSearch.requests, 2);
    assert.equal(snapshot.operations.semanticSearch.successRate, 50);
    assert.equal(snapshot.operations.semanticSearch.p50Ms, 10);
    assert.equal(snapshot.operations.semanticSearch.p95Ms, 20);
    assert.equal(snapshot.operations.semanticSearch.lastErrorCode, "BOOM");
    assert.equal(snapshot.chat.providers["gemini:test"], 1);
    assert.equal(snapshot.chat.toolCalls, 2);
    assert.equal(snapshot.chat.catalogGroundedChats, 1);
});

test("AI evaluation routes are public snapshots but benchmark execution is separately rate-limited", () => {
    const routes = read("backend/src/routes/ai.routes.js");
    assert.match(routes, /router\.get\("\/evaluation", aiEvaluation\)/);
    assert.match(routes, /router\.post\("\/evaluation\/run", evaluationRunLimiter, runAiEvaluation\)/);
    assert.match(routes, /windowMs:\s*60 \* 60 \* 1000/);
});

test("evaluation dashboard is wired into the frontend without exposing embedding arrays", () => {
    const page = read("frontend/src/pages/AiEvaluationPage.jsx");
    const services = read("frontend/src/services/index.js");
    const routes = read("frontend/src/routes/AppRoutes.jsx");
    const sidebar = read("frontend/src/layouts/Sidebar.jsx");

    assert.match(page, /Top-1 accuracy/);
    assert.match(page, /Recall@5/);
    assert.match(page, /Runtime operations/);
    assert.match(page, /Video embedding coverage/);
    assert.doesNotMatch(page, /\.embedding\s*\[/);
    assert.match(services, /evaluation: \(\) => apiClient\.get\("\/ai\/evaluation"\)/);
    assert.match(routes, /AiEvaluationPage/);
    assert.match(sidebar, /AI Evaluation/);
});
