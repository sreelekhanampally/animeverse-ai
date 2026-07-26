import { Rss } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";

export default function SubscriptionsPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Rss}
                title="Subscriptions"
                subtitle="Everything from the creators you follow."
            />
            <EmptyState
                icon={Rss}
                title="No subscriptions yet"
                message="Follow creators to see their newest uploads here."
            />
        </div>
    );
}
