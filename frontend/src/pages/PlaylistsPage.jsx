import { ListVideo, Plus } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/Button";

export default function PlaylistsPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={ListVideo}
                title="Playlists"
                subtitle="Your curated queues and watch collections."
                action={
                    <Button size="sm" variant="primary" disabled>
                        <Plus className="h-4 w-4" /> New playlist
                    </Button>
                }
            />
            <EmptyState
                icon={ListVideo}
                title="No playlists yet"
                message="Save videos into playlists to marathon them later."
            />
        </div>
    );
}
