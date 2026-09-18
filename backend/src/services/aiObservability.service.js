const PROCESS_STARTED_AT = new Date();
const MAX_LATENCY_SAMPLES = 240;

const makeMetric = () => ({
    requests: 0,
    successes: 0,
    failures: 0,
    latencyMs: [],
    lastRequestAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
});

const state = {
    operations: new Map(),
    chatProviders: new Map(),
    toolCalls: 0,
    catalogGroundedChats: 0,
    lastBenchmark: null,
};

const metricFor = (name) => {
    if (!state.operations.has(name)) state.operations.set(name, makeMetric());
    return state.operations.get(name);
};

const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return Number(sorted[index].toFixed(1));
};

const summarizeMetric = (metric) => ({
    requests: metric.requests,
    successes: metric.successes,
    failures: metric.failures,
    successRate:
        metric.requests > 0 ? Number(((metric.successes / metric.requests) * 100).toFixed(1)) : null,
    p50Ms: percentile(metric.latencyMs, 0.5),
    p95Ms: percentile(metric.latencyMs, 0.95),
    sampleCount: metric.latencyMs.length,
    lastRequestAt: metric.lastRequestAt,
    lastErrorAt: metric.lastErrorAt,
    lastErrorCode: metric.lastErrorCode,
});

export function recordAiOperation(
    name,
    { durationMs = 0, success = true, provider = "", toolCalls = 0, usedCatalog = false, errorCode = "" } = {}
) {
    const metric = metricFor(name);
    metric.requests += 1;
    metric.lastRequestAt = new Date().toISOString();
    if (success) metric.successes += 1;
    else {
        metric.failures += 1;
        metric.lastErrorAt = metric.lastRequestAt;
        metric.lastErrorCode = String(errorCode || "UNKNOWN_ERROR").slice(0, 120);
    }

    const duration = Number(durationMs);
    if (Number.isFinite(duration) && duration >= 0) {
        metric.latencyMs.push(duration);
        if (metric.latencyMs.length > MAX_LATENCY_SAMPLES) metric.latencyMs.shift();
    }

    if (name === "chat") {
        if (provider) {
            state.chatProviders.set(provider, (state.chatProviders.get(provider) || 0) + 1);
        }
        state.toolCalls += Math.max(0, Number(toolCalls) || 0);
        if (usedCatalog) state.catalogGroundedChats += 1;
    }
}

export function setLastBenchmark(result) {
    state.lastBenchmark = result || null;
}

export function getAiObservabilitySnapshot() {
    return {
        processStartedAt: PROCESS_STARTED_AT.toISOString(),
        uptimeSeconds: Math.floor((Date.now() - PROCESS_STARTED_AT.getTime()) / 1000),
        note: "Runtime request metrics are in-memory and reset when the backend process restarts.",
        operations: Object.fromEntries(
            [...state.operations.entries()].map(([name, metric]) => [name, summarizeMetric(metric)])
        ),
        chat: {
            providers: Object.fromEntries(state.chatProviders.entries()),
            toolCalls: state.toolCalls,
            catalogGroundedChats: state.catalogGroundedChats,
        },
        lastBenchmark: state.lastBenchmark,
    };
}

export function resetAiObservabilityForTests() {
    state.operations.clear();
    state.chatProviders.clear();
    state.toolCalls = 0;
    state.catalogGroundedChats = 0;
    state.lastBenchmark = null;
}

export const aiObservabilityInternals = { percentile };
