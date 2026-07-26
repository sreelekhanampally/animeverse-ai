import { History } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";

export default function HistoryPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={History}
                title="Watch history"
                subtitle="Everything you've watched, in one scroll."
            />
            <EmptyState
                icon={History}
                title="Nothing in your history"
                message="Videos you watch appear here for easy rewinds."
            />
        </div>
    );
}
