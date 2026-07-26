import { Users } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { CommunityPreview } from "@/features/community/CommunityPreview";
import { useCommunityFeed } from "@/features/community/hooks";

export default function CommunityPage() {
    const { data, isLoading, error } = useCommunityFeed({ limit: 24 });
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Users}
                title="Community"
                subtitle="Threads, hot takes, and creator posts."
            />
            <CommunityPreview posts={data} isLoading={isLoading} error={error} />
        </div>
    );
}
