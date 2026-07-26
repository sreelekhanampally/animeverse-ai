import { ThumbsUp } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";

export default function LikedPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={ThumbsUp}
                title="Liked videos"
                subtitle="Everything you gave a thumbs-up."
            />
            <EmptyState
                icon={ThumbsUp}
                title="No likes yet"
                message="Like a video and it will appear in this list."
            />
        </div>
    );
}
