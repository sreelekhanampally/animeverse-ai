import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Send, MessageCircle, Newspaper, BarChart3, Image as ImageIcon } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { CommunityPreview } from "@/features/community/CommunityPreview";
import {
    useCommunityFeed,
    useCreateCommunityPost,
    useUpvoteCommunityPost,
    useVoteCommunityPost,
} from "@/features/community/hooks";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { extractErrorMessage } from "@/services";
import { cn } from "@/utils/cn";

const TYPES = [
    { value: "discussion", label: "Discussion", icon: MessageCircle },
    { value: "news", label: "News", icon: Newspaper },
    { value: "poll", label: "Poll", icon: BarChart3 },
    { value: "meme", label: "Meme", icon: ImageIcon },
];

const VALID_TYPES = new Set(TYPES.map((item) => item.value));

export default function CommunityPage() {
    const { user } = useAuth();
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryType = searchParams.get("type") || "";
    const filter = VALID_TYPES.has(queryType) ? queryType : "";

    const [type, setType] = useState("discussion");
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [pollOptions, setPollOptions] = useState(["", ""]);

    const filterItems = useMemo(() => [{ value: "", label: "All" }, ...TYPES], []);
    const { data, isLoading, error, refetch } = useCommunityFeed({
        limit: 30,
        type: filter || undefined,
    });
    const createPost = useCreateCommunityPost();
    const upvote = useUpvoteCommunityPost();
    const vote = useVoteCommunityPost();

    const setFilter = (value) => {
        if (value) setSearchParams({ type: value });
        else setSearchParams({});
    };

    const submit = async (event) => {
        event.preventDefault();
        if (!user) return toast.info("Sign in to post in the community");
        if (!title.trim()) return toast.info("Add a title first");

        const payload = {
            type,
            title: title.trim(),
            content: content.trim(),
            ...(type === "meme" && imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        };

        if (type === "poll") {
            const options = pollOptions.map((option) => option.trim()).filter(Boolean);
            if (options.length < 2) return toast.info("A poll needs at least two options");
            payload.pollOptions = options;
        }

        try {
            await createPost.mutateAsync(payload);
            setTitle("");
            setContent("");
            setImageUrl("");
            setPollOptions(["", ""]);
            toast.success("Post published");
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't publish your post"));
        }
    };

    const onUpvote = async (post) => {
        if (!user) return toast.info("Sign in to upvote posts");
        try {
            await upvote.mutateAsync(post._id);
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't update the upvote"));
        }
    };

    const onVote = async (post, optionIndex) => {
        if (!user) return toast.info("Sign in to vote in polls");
        try {
            await vote.mutateAsync({ postId: post._id, optionIndex });
        } catch (err) {
            toast.error(extractErrorMessage(err, "Couldn't record your vote"));
        }
    };

    return (
        <div className="space-y-8">
            <SectionHeader
                icon={Users}
                title="Community"
                subtitle="Talk anime, share news, run polls, and join ongoing discussions."
            />

            {user ? (
                <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/10 bg-card/60 p-4 sm:p-5">
                    <div className="flex flex-wrap gap-2">
                        {TYPES.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setType(value)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                                    type === value
                                        ? "border-primary/50 bg-primary/20 text-white"
                                        : "border-white/10 bg-white/[0.03] text-muted hover:text-white"
                                )}
                            >
                                <Icon className="h-3.5 w-3.5" /> {label}
                            </button>
                        ))}
                    </div>

                    <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={160}
                        placeholder="Start a conversation..."
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-muted focus:border-primary/50"
                    />
                    <textarea
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        maxLength={1200}
                        rows={3}
                        placeholder="Add some context or your take."
                        className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-muted focus:border-primary/50"
                    />

                    {type === "meme" && (
                        <input
                            type="url"
                            value={imageUrl}
                            onChange={(event) => setImageUrl(event.target.value)}
                            maxLength={1000}
                            placeholder="Image URL (https://...)"
                            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-muted focus:border-primary/50"
                        />
                    )}

                    {type === "poll" && (
                        <div className="grid gap-2 sm:grid-cols-2">
                            {pollOptions.map((option, index) => (
                                <input
                                    key={index}
                                    value={option}
                                    onChange={(event) => {
                                        const next = [...pollOptions];
                                        next[index] = event.target.value;
                                        setPollOptions(next);
                                    }}
                                    maxLength={120}
                                    placeholder={`Poll option ${index + 1}`}
                                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-muted focus:border-primary/50"
                                />
                            ))}
                            {pollOptions.length < 6 && (
                                <button
                                    type="button"
                                    onClick={() => setPollOptions((current) => [...current, ""])}
                                    className="text-left text-xs font-medium text-accent hover:text-white"
                                >
                                    + Add option
                                </button>
                            )}
                        </div>
                    )}

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={createPost.isPending || !title.trim()}
                            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Send className="h-4 w-4" /> {createPost.isPending ? "Posting..." : "Post"}
                        </button>
                    </div>
                </form>
            ) : (
                <div className="rounded-2xl border border-white/10 bg-card/50 p-4 text-sm text-muted">
                    You can read everything here. Sign in to post, reply, vote, or upvote.
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {filterItems.map((item) => (
                    <button
                        key={item.value || "all"}
                        type="button"
                        onClick={() => setFilter(item.value)}
                        className={cn(
                            "rounded-full border px-3 py-1.5 text-xs transition",
                            filter === item.value
                                ? "border-accent/50 bg-accent/15 text-white"
                                : "border-white/10 text-muted hover:text-white"
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {error ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-sm text-rose-200">
                    Couldn't load community posts. <button onClick={() => refetch()} className="underline">Retry</button>
                </div>
            ) : (
                <CommunityPreview
                    posts={data}
                    isLoading={isLoading}
                    error={error}
                    onUpvote={onUpvote}
                    canUpvote={!!user}
                    onVote={onVote}
                    canVote={!!user}
                    limit={30}
                    showHeader={false}
                />
            )}
        </div>
    );
}
