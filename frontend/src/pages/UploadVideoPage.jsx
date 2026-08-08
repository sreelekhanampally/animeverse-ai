import { Upload, Film } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { EmptyState } from "@/components/common/EmptyState";

export default function UploadVideoPage() {
    return (
        <div className="space-y-6">
            <SectionHeader
                icon={Upload}
                title="Upload Video"
                subtitle="Share your video with the AnimeVerse community."
            />
            <EmptyState
                icon={Film}
                title="Upload form coming soon"
                message="The video upload form will live here. Routing is wired up  -  the file picker, thumbnail, and details fields are next."
            />
        </div>
    );
}