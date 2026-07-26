import { Sparkles, Search } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function AiSearchPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Sparkles}
                title="AI Search"
                subtitle="Semantic search across every video, transcript, and post."
            />
            <div className="gradient-border rounded-2xl">
                <div className="flex flex-col gap-3 rounded-2xl bg-card/70 p-4 backdrop-blur sm:flex-row sm:items-center">
                    <Input
                        placeholder="e.g. that fight scene in Attack on Titan where the walls crumble"
                        leftIcon={<Search className="h-4 w-4" />}
                        className="flex-1"
                    />
                    <Button variant="primary" disabled>
                        <Sparkles className="h-4 w-4" /> Coming in Session 2
                    </Button>
                </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-sm text-muted">
                <p>
                    Semantic AI search will land in the next session. The frontend is already wired to
                    <code className="mx-1 rounded bg-white/10 px-1 text-white/85">aiService.search</code>
                    for a smooth handoff.
                </p>
            </div>
        </div>
    );
}
