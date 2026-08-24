import { Bot, Sparkles } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";

export default function AiChatPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Bot}
                title="Ask"
                subtitle="Talk to the AnimeVerse companion  -  coming soon."
            />
            <EmptyState
                icon={Sparkles}
                title="Companion is asleep"
                message="The chat interface will be wired up in Session 2 (RAG + Whisper + embeddings)."
            />
        </div>
    );
}
