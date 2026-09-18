import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Activity,
    Bot,
    CheckCircle2,
    Clock3,
    Database,
    Gauge,
    Play,
    RefreshCw,
    Search,
    ShieldCheck,
    Sparkles,
    TriangleAlert,
    Workflow,
} from "lucide-react";
import { aiService } from "@/services";

const pct = (value) => (value == null ? "—" : `${value}%`);
const ms = (value) => (value == null ? "—" : `${Math.round(value)} ms`);

const operationLabels = {
    semanticSearch: "Search",
    chat: "Assistant",
    similarVideos: "Similar videos",
    discoveryGraph: "Discovery graph",
    dynamicCollections: "Collections",
};

const operationLabel = (name) =>
    operationLabels[name] || name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

const providerLabel = (value) => {
    const labels = {
        gemini: "Gemini",
        ollama: "Ollama",
        local: "Local",
        "local-retrieval": "Local retrieval",
    };
    return labels[value] || value || "—";
};

function StatCard({ icon: Icon, label, value, detail }) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-white/45">
                <Icon className="h-4 w-4 text-accent" />
                {label}
            </div>
            <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
            {detail && <div className="mt-1 text-sm text-white/50">{detail}</div>}
        </div>
    );
}

function Coverage({ label, value, embedded, total }) {
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    return (
        <div>
            <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-white/70">{label}</span>
                <span className="font-medium text-white">{embedded}/{total} · {safe.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${safe}%` }} />
            </div>
        </div>
    );
}

function Pill({ children, tone = "neutral" }) {
    const cls =
        tone === "good"
            ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
            : tone === "warn"
              ? "border-amber-400/25 bg-amber-400/10 text-amber-200"
              : "border-white/10 bg-white/5 text-white/65";
    return <span className={`rounded-full border px-2.5 py-1 text-xs ${cls}`}>{children}</span>;
}

export default function AiEvaluationPage() {
    const queryClient = useQueryClient();
    const evaluationQuery = useQuery({
        queryKey: ["ai-evaluation"],
        queryFn: async () => (await aiService.evaluation()).data?.data,
        refetchInterval: 10_000,
        staleTime: 5_000,
    });

    const runMutation = useMutation({
        mutationFn: async () => (await aiService.runEvaluation()).data?.data,
        onSuccess: (data) => queryClient.setQueryData(["ai-evaluation"], data),
    });

    const data = evaluationQuery.data;
    const benchmark = data?.benchmark || data?.runtime?.lastBenchmark || null;
    const operations = useMemo(
        () => Object.entries(data?.runtime?.operations || {}),
        [data?.runtime?.operations]
    );

    if (evaluationQuery.isLoading) {
        return <div className="p-6 text-white/60">Loading evaluation data…</div>;
    }

    if (evaluationQuery.isError || !data) {
        return (
            <div className="mx-auto max-w-4xl p-6">
                <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-5 text-red-100">
                    <div className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-5 w-5" /> Could not load evaluation data</div>
                    <p className="mt-2 text-sm text-red-100/70">{evaluationQuery.error?.message || "The server did not return evaluation data."}</p>
                    <button onClick={() => evaluationQuery.refetch()} className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15">Retry</button>
                </div>
            </div>
        );
    }

    const searchMetric = data.runtime?.operations?.semanticSearch;
    const chatMetric = data.runtime?.operations?.chat;
    const chat = data.assistant || {};
    const gemini = chat.gemini || {};

    return (
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-primary/10 via-white/[0.035] to-accent/10 p-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent">
                        <Activity className="h-4 w-4" /> AI Evaluation
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Search quality and system health</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
                        Track search quality, response time, embedding coverage, and assistant provider status.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Pill tone={data.embedding?.loadedInProcess ? "good" : "warn"}>Embedding model: {data.embedding?.loadedInProcess ? "loaded" : "not loaded"}</Pill>
                        <Pill tone={gemini.configured ? "good" : "warn"}>Gemini: {gemini.configured ? "connected" : "not configured"}</Pill>
                        <Pill>Stats reset when the backend restarts</Pill>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => evaluationQuery.refetch()}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10"
                    >
                        <RefreshCw className={`h-4 w-4 ${evaluationQuery.isFetching ? "animate-spin" : ""}`} /> Refresh
                    </button>
                    <button
                        onClick={() => runMutation.mutate()}
                        disabled={runMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/15 disabled:opacity-50"
                    >
                        {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {runMutation.isPending ? "Running…" : "Run benchmark"}
                    </button>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard icon={Database} label="Videos" value={data.catalogue?.videos?.published ?? 0} detail={`${data.catalogue?.videos?.bySource?.youtube || 0} YouTube · ${data.catalogue?.videos?.bySource?.cloudinary || 0} uploaded`} />
                <StatCard icon={Sparkles} label="Video embeddings" value={pct(data.catalogue?.videos?.coverage)} detail={`${data.catalogue?.videos?.embedded ?? 0} indexed videos`} />
                <StatCard icon={Search} label="Search latency (p95)" value={ms(searchMetric?.p95Ms)} detail={searchMetric?.requests ? `${searchMetric.requests} requests` : "No search requests yet"} />
                <StatCard icon={Bot} label="Chat latency (p95)" value={ms(chatMetric?.p95Ms)} detail={chatMetric?.requests ? `${chatMetric.requests} chats` : "No chat requests yet"} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                    <div className="flex items-center gap-2 font-semibold text-white"><Database className="h-5 w-5 text-accent" /> Corpus & embeddings</div>
                    <div className="mt-5 space-y-5">
                        <Coverage label="Video coverage" value={data.catalogue?.videos?.coverage} embedded={data.catalogue?.videos?.embedded ?? 0} total={data.catalogue?.videos?.published ?? 0} />
                        <Coverage label="Anime coverage" value={data.catalogue?.anime?.coverage} embedded={data.catalogue?.anime?.embedded ?? 0} total={data.catalogue?.anime?.total ?? 0} />
                    </div>
                    <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-xl bg-white/[0.035] p-3"><div className="text-white/45">Model</div><div className="mt-1 break-words text-white/80">{data.embedding?.model}</div></div>
                        <div className="rounded-xl bg-white/[0.035] p-3"><div className="text-white/45">Vector format</div><div className="mt-1 text-white/80">{data.embedding?.dimensions}d · {data.embedding?.version}</div></div>
                        <div className="rounded-xl bg-white/[0.035] p-3"><div className="text-white/45">Metadata sources</div><div className="mt-1 text-white/80">{Object.entries(data.catalogue?.anime?.byMetadataSource || {}).map(([k,v]) => `${k}: ${v}`).join(" · ") || "—"}</div></div>
                        <div className="rounded-xl bg-white/[0.035] p-3"><div className="text-white/45">Provider</div><div className="mt-1 text-white/80">{data.embedding?.provider}</div></div>
                    </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                    <div className="flex items-center gap-2 font-semibold text-white"><Workflow className="h-5 w-5 text-accent" /> Assistant status</div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <StatCard icon={Bot} label="Primary provider" value={providerLabel(chat.preferred || "local")} detail={`Mode: ${chat.mode || "auto"}`} />
                        <StatCard icon={ShieldCheck} label="Backup" value={providerLabel(chat.fallback || "local-retrieval")} detail="Used if the primary provider is unavailable" />
                    </div>
                    <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-white/50">Gemini model</span><span className="text-white/80">{gemini.model || "—"}</span></div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-white/50">Backup models</span><span className="text-right text-white/70">{gemini.fallbackModels?.join(", ") || "—"}</span></div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-white/50">Tool calls</span><span className="text-white/80">{data.runtime?.chat?.toolCalls ?? 0}</span></div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-white/50">Catalog lookups</span><span className="text-white/80">{data.runtime?.chat?.catalogGroundedChats ?? 0}</span></div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(data.runtime?.chat?.providers || {}).length ? Object.entries(data.runtime.chat.providers).map(([provider,count]) => <Pill key={provider}>{provider}: {count}</Pill>) : <span className="text-sm text-white/40">No chat traffic yet.</span>}
                    </div>
                </section>
            </div>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <div className="flex items-center justify-between gap-3">
                    <div><div className="flex items-center gap-2 font-semibold text-white"><Gauge className="h-5 w-5 text-accent" /> Runtime metrics</div><p className="mt-1 text-sm text-white/45">Since the last backend restart.</p></div>
                </div>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wider text-white/35"><tr><th className="px-3 py-2">Operation</th><th className="px-3 py-2">Requests</th><th className="px-3 py-2">Success rate</th><th className="px-3 py-2">p50</th><th className="px-3 py-2">p95</th><th className="px-3 py-2">Last seen</th></tr></thead>
                        <tbody className="divide-y divide-white/5">
                            {operations.length ? operations.map(([name, metric]) => (
                                <tr key={name} className="text-white/70"><td className="px-3 py-3 font-medium text-white/85">{operationLabel(name)}</td><td className="px-3 py-3">{metric.requests}</td><td className="px-3 py-3">{pct(metric.successRate)}</td><td className="px-3 py-3">{ms(metric.p50Ms)}</td><td className="px-3 py-3">{ms(metric.p95Ms)}</td><td className="px-3 py-3 text-white/45">{metric.lastRequestAt ? new Date(metric.lastRequestAt).toLocaleTimeString() : "—"}</td></tr>
                            )) : <tr><td colSpan="6" className="px-3 py-6 text-center text-white/40">Use Search, Discovery Lab, or the Assistant to generate runtime data.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><div className="flex items-center gap-2 font-semibold text-white"><CheckCircle2 className="h-5 w-5 text-accent" /> Search benchmark</div><p className="mt-1 text-sm text-white/45">8 fixed queries checked against known anime titles in the catalog.</p></div>
                    {benchmark?.ranAt && <Pill>Updated {new Date(benchmark.ranAt).toLocaleString()}</Pill>}
                </div>

                {runMutation.isError && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-200">{runMutation.error?.message || "Benchmark failed"}</div>}

                {benchmark ? (
                    <>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            <StatCard icon={Search} label="Top-1" value={pct(benchmark.metrics?.top1Accuracy)} detail={`${benchmark.metrics?.eligibleQueries ?? 0} queries`} />
                            <StatCard icon={CheckCircle2} label="Top-5 recall" value={pct(benchmark.metrics?.recallAt5)} detail="Expected title appears in the first 5 results" />
                            <StatCard icon={Gauge} label="MRR" value={benchmark.metrics?.mrr ?? "—"} detail="Ranking quality" />
                            <StatCard icon={Clock3} label="Median latency" value={ms(benchmark.metrics?.p50Ms)} />
                            <StatCard icon={Clock3} label="p95 latency" value={ms(benchmark.metrics?.p95Ms)} />
                        </div>
                        <div className="mt-5 overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left text-sm">
                                <thead className="text-xs uppercase tracking-wider text-white/35"><tr><th className="px-3 py-2">Query</th><th className="px-3 py-2">Expected title</th><th className="px-3 py-2">First result</th><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Status</th></tr></thead>
                                <tbody className="divide-y divide-white/5">
                                    {benchmark.rows?.map((row) => (
                                        <tr key={row.id} className="text-white/70">
                                            <td className="max-w-[280px] px-3 py-3 text-white/85">{row.query}</td><td className="px-3 py-3">{row.expected}</td><td className="px-3 py-3">{row.topHit || "—"}</td><td className="px-3 py-3">{row.rank ? `#${row.rank}` : "—"}</td><td className="px-3 py-3">{ms(row.latencyMs)}</td><td className="px-3 py-3">{!row.available ? <Pill tone="warn">not in catalog</Pill> : row.error ? <Pill tone="warn">error</Pill> : row.rank === 1 ? <Pill tone="good">Top 1</Pill> : row.rank && row.rank <= 5 ? <Pill tone="good">Top 5</Pill> : <Pill tone="warn">Miss</Pill>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/10 p-8 text-center">
                        <Search className="mx-auto h-8 w-8 text-white/25" />
                        <div className="mt-3 font-medium text-white/75">No benchmark results yet.</div>
                        <p className="mt-1 text-sm text-white/40">Run the benchmark to check search accuracy and latency on the current catalog.</p>
                    </div>
                )}
            </section>
        </div>
    );
}
