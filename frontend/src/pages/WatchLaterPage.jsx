import { Clock } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";

export default function WatchLaterPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Clock}
                title="Watch later"
                subtitle="Your saved queue for when you're free."
            />
            <EmptyState
                icon={Clock}
                title="Queue is empty"
                message="Tap the clock on any video to save it for later."
            />
        </div>
    );
}
