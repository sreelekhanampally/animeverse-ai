import { useCallback, useEffect, useState } from "react";
import { Search, Sparkles, RefreshCw, Database, Youtube, Cloud } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { SectionHeader } from "@/features/home/SectionHeader";
import { VideoCardSkeleton } from "@/features/video/VideoCard";
import { ExplainableVideoCard } from "@/features/discovery/ExplainableVideoCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/common/EmptyState";
import { aiService } from "@/services";
import { extractErrorMessage } from "@/services/apiClient";

const EXAMPLES = [
    "Naruto fighting Pain",
    "alchemy brothers restoring their bodies",
    "time travel experiments gone wrong",
    "high school volleyball team",
];

export default function AiSearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const urlQuery = searchParams.get("q") || "";
    const [query, setQuery] = useState(urlQuery);
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [hasSearched, setHasSearched] = useState(false);

    const runSearch = useCallback(async (rawQuery) => {
        const q = rawQuery.trim();
        if (q.length < 2) {
            setError("Enter at least 2 characters.");
            return;
        }

        setLoading(true);
        setError("");
        setHasSearched(true);
        try {
            const response = await aiService.semanticSearch(q, 12);
            setResults(response?.data?.data?.results || []);
        } catch (err) {
            setResults([]);
            setError(extractErrorMessage(err, "AI search is unavailable right now."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        setQuery(urlQuery);
        if (urlQuery.trim().length >= 2) runSearch(urlQuery);
    }, [urlQuery, runSearch]);

    const onSubmit = (event) => {
        event.preventDefault();
        const q = query.trim();
        if (q.length < 2) {
            setError("Enter at least 2 characters.");
            return;
        }
        setSearchParams({ q });
        if (q === urlQuery) runSearch(q);
    };

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Sparkles}
                title="AI Search"
                subtitle="Describe an anime, character, theme, or video in natural language."
            />

            <form onSubmit={onSubmit} className="gradient-border rounded-2xl">
                <div className="flex flex-col gap-3 rounded-2xl bg-card/70 p-4 backdrop-blur sm:flex-row sm:items-center">
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="e.g. two brothers using alchemy to restore their bodies"
                        leftIcon={<Search className="h-4 w-4" />}
                        className="flex-1"
                        maxLength={300}
                    />
                    <Button variant="primary" type="submit" disabled={loading || query.trim().length < 2}>
                        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {loading ? "Searching" : "Search"}
                    </Button>
                </div>
            </form>

            {!hasSearched && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                        <Database className="h-4 w-4 text-accent" /> Try a natural-language search
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {EXAMPLES.map((example) => (
                            <button
                                key={example}
                                type="button"
                                onClick={() => {
                                    setQuery(example);
                                    setSearchParams({ q: example });
                                }}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted transition hover:border-primary/50 hover:text-white"
                            >
                                {example}
                            </button>
                        ))}
                    </div>
                    <p className="mt-4 text-xs leading-relaxed text-muted">
                        Search is grounded in AnimeVerse metadata and stored embeddings. It does not claim exact YouTube scene timestamps or inspect YouTube media.
                    </p>
                </div>
            )}

            {error && (
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-100">
                    <span>{error}</span>
                    <Button variant="ghost" size="sm" onClick={() => runSearch(query)} disabled={loading}>
                        Retry
                    </Button>
                </div>
            )}

            {loading && (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <VideoCardSkeleton key={index} />
                    ))}
                </div>
            )}

            {!loading && hasSearched && !error && results.length === 0 && (
                <EmptyState
                    icon={Search}
                    title="No indexed match found"
                    message="Try an anime title, character, genre, or a broader description."
                />
            )}

            {!loading && results.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted">
                            {results.length} ranked result{results.length === 1 ? "" : "s"}
                        </p>
                        <span className="text-xs text-muted">Semantic + title-aware ranking</span>
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                        {results.map((result) => {
                            const video = result.video;
                            const isYouTube = video?.sourceType === "youtube";
                            return (
                                <div key={video?._id} className="space-y-2">
                                    <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
                                        <span className="inline-flex items-center gap-1">
                                            {isYouTube ? <Youtube className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
                                            {isYouTube ? "YouTube embed" : "Creator upload"}
                                        </span>
                                    </div>
                                    <ExplainableVideoCard
                                        video={video}
                                        reasons={result.reasons || []}
                                        score={result.score}
                                        label="Why it matched"
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
