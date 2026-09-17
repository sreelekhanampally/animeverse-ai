import { useEffect, useMemo, useState } from "react";
import { Compass, Network, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionHeader } from "@/features/home/SectionHeader";
import { ExplainableVideoCard } from "@/features/discovery/ExplainableVideoCard";
import { SemanticGraph } from "@/features/discovery/SemanticGraph";
import { aiService } from "@/services";
import { extractErrorMessage } from "@/services/apiClient";

const PRESETS = [
    "dark psychological anime trailers",
    "high-energy shonen promos",
    "emotional anime videos",
    "cyberpunk and dystopian anime",
    "sports anime hype videos",
    "beautiful fantasy anime trailers",
];

export default function DiscoveryPage() {
    const [prompt, setPrompt] = useState(PRESETS[0]);
    const [collection, setCollection] = useState(null);
    const [graph, setGraph] = useState(null);
    const [loading, setLoading] = useState(false);
    const [graphLoading, setGraphLoading] = useState(false);
    const [error, setError] = useState("");

    const topVideoId = collection?.results?.[0]?.video?._id;

    const runCollection = async (rawPrompt = prompt) => {
        const q = String(rawPrompt || "").trim();
        if (q.length < 2) {
            setError("Describe the kind of anime video collection you want.");
            return;
        }
        setLoading(true);
        setError("");
        setGraph(null);
        try {
            const response = await aiService.buildCollection(q, 18);
            setCollection(response?.data?.data || null);
        } catch (err) {
            setCollection(null);
            setError(extractErrorMessage(err, "Could not build this collection right now."));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;
        if (!topVideoId) return undefined;
        setGraphLoading(true);
        aiService
            .discoveryGraph(topVideoId, 9)
            .then((response) => {
                if (!cancelled) setGraph(response?.data?.data || null);
            })
            .catch(() => {
                if (!cancelled) setGraph(null);
            })
            .finally(() => {
                if (!cancelled) setGraphLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [topVideoId]);

    const resultCount = collection?.results?.length || 0;
    const collectionTitle = useMemo(() => collection?.title || prompt, [collection, prompt]);

    return (
        <div className="space-y-8">
            <SectionHeader
                icon={Compass}
                title="AI Discovery Lab"
                subtitle="Build live collections from the catalogue, see why videos matched, and explore the semantic neighborhood around the strongest result."
            />

            <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-primary/[0.08] via-card/70 to-accent/[0.05] p-5 sm:p-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <WandSparkles className="h-4 w-4 text-accent" /> Describe a collection
                </div>
                <form
                    className="mt-4 flex flex-col gap-3 md:flex-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        runCollection();
                    }}
                >
                    <Input
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="e.g. intense anime trailers with cyberpunk themes"
                        className="flex-1"
                        maxLength={240}
                    />
                    <Button type="submit" variant="primary" disabled={loading || prompt.trim().length < 2}>
                        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {loading ? "Building" : "Build collection"}
                    </Button>
                </form>
                <div className="mt-4 flex flex-wrap gap-2">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            onClick={() => {
                                setPrompt(preset);
                                runCollection(preset);
                            }}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted transition hover:border-accent/40 hover:text-white"
                        >
                            {preset}
                        </button>
                    ))}
                </div>
            </section>

            {error && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-100">
                    {error}
                </div>
            )}

            {!collection && !loading && !error && (
                <EmptyState
                    icon={Compass}
                    title="Create a semantic collection"
                    message="AnimeVerse will rank real catalogue videos using local embeddings and linked anime metadata."
                />
            )}

            {collection && (
                <section className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Live semantic collection</div>
                            <h2 className="mt-1 font-display text-2xl font-semibold text-white">{collectionTitle}</h2>
                            <p className="mt-1 text-sm text-muted">{collection.description}</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted">
                            {resultCount} ranked videos
                        </span>
                    </div>

                    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                        {(collection.results || []).map((result) => (
                            <ExplainableVideoCard
                                key={result.video?._id}
                                video={result.video}
                                reasons={result.reasons}
                                score={result.score}
                                label="Why it belongs"
                            />
                        ))}
                    </div>
                </section>
            )}

            {topVideoId && (
                <section className="rounded-3xl border border-white/10 bg-card/50 p-5 sm:p-6">
                    <div className="mb-4 flex items-center gap-2">
                        <Network className="h-5 w-5 text-accent" />
                        <div>
                            <h2 className="font-display text-lg font-semibold text-white">Semantic map around the top match</h2>
                            <p className="text-xs text-muted">A visual neighborhood built from stored video embeddings.</p>
                        </div>
                    </div>
                    {graphLoading ? (
                        <div className="flex h-[420px] items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] text-sm text-muted">
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Building semantic map…
                        </div>
                    ) : (
                        <SemanticGraph graph={graph} />
                    )}
                </section>
            )}
        </div>
    );
}
