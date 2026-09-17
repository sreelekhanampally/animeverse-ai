import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Network, Play } from "lucide-react";
import { cn } from "@/utils/cn";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function SemanticGraph({ graph, className }) {
    const navigate = useNavigate();
    const nodes = graph?.nodes || [];
    const source = nodes.find((node) => node.isSource) || nodes[0];
    const neighbors = nodes.filter((node) => !node.isSource).slice(0, 10);

    const positions = useMemo(
        () =>
            neighbors.map((node, index) => {
                const angle = (Math.PI * 2 * index) / Math.max(1, neighbors.length) - Math.PI / 2;
                const radius = neighbors.length > 7 ? 41 : 38;
                return {
                    ...node,
                    x: 50 + Math.cos(angle) * radius,
                    y: 50 + Math.sin(angle) * radius,
                };
            }),
        [neighbors]
    );

    if (!source) {
        return (
            <div className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-sm text-muted", className)}>
                No semantic graph is available for this video yet.
            </div>
        );
    }

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Network className="h-4 w-4 text-accent" /> Semantic neighborhood
            </div>
            <div className="relative h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-primary/[0.08] via-card/70 to-accent/[0.05]">
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    {positions.map((node) => (
                        <line
                            key={`edge-${node.id}`}
                            x1="50"
                            y1="50"
                            x2={node.x}
                            y2={node.y}
                            stroke="currentColor"
                            strokeOpacity={clamp((node.score || 0) * 0.55, 0.12, 0.5)}
                            strokeWidth={clamp((node.score || 0) * 0.7, 0.18, 0.65)}
                            className="text-accent"
                        />
                    ))}
                </svg>

                <button
                    type="button"
                    onClick={() => navigate(`/watch/${source.id}`)}
                    className="absolute left-1/2 top-1/2 z-10 w-36 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-primary/40 bg-primary/20 p-3 text-left shadow-glow backdrop-blur transition hover:scale-[1.03]"
                    title={source.video?.title}
                >
                    <div className="mb-2 aspect-video overflow-hidden rounded-xl bg-black/30">
                        {source.video?.thumbnail && (
                            <img src={source.video.thumbnail} alt="" className="h-full w-full object-cover" />
                        )}
                    </div>
                    <div className="line-clamp-2 text-xs font-semibold text-white">{source.video?.title}</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent">
                        <Play className="h-3 w-3" /> Current video
                    </div>
                </button>

                {positions.map((node) => (
                    <button
                        key={node.id}
                        type="button"
                        onClick={() => navigate(`/watch/${node.id}`)}
                        style={{ left: `${node.x}%`, top: `${node.y}%` }}
                        className="absolute z-10 w-28 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-bg/85 p-2 text-left shadow-xl backdrop-blur transition hover:z-20 hover:scale-110 hover:border-accent/50"
                        title={`${node.video?.title || "Related video"} · ${Math.round((node.score || 0) * 100)}% match`}
                    >
                        <div className="aspect-video overflow-hidden rounded-lg bg-white/5">
                            {node.video?.thumbnail && (
                                <img src={node.video.thumbnail} alt="" className="h-full w-full object-cover" />
                            )}
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-[10px] font-medium leading-tight text-white/90">
                            {node.video?.title}
                        </div>
                        <div className="mt-1 text-[9px] text-accent">{Math.round((node.score || 0) * 100)}% nearby</div>
                    </button>
                ))}
            </div>
            <p className="text-xs leading-relaxed text-muted">
                Distance is derived from local MiniLM embeddings plus lightweight anime/metadata overlap. It is a discovery map, not a social graph.
            </p>
        </div>
    );
}
