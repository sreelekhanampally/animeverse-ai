import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Bot,
    Send,
    Sparkles,
    User,
    RefreshCw,
    PlayCircle,
    Search,
    ShieldCheck,
    MessageSquarePlus,
} from "lucide-react";
import { Link } from "react-router-dom";
import { SectionHeader } from "@/features/home/SectionHeader";
import { Button } from "@/components/ui/Button";
import { aiService } from "@/services";
import { extractErrorMessage } from "@/services/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import {
    animeChatSessionKey,
    clearAnimeChatSession,
    loadAnimeChatSession,
    saveAnimeChatSession,
} from "@/utils/chatSession";

const createStarter = () => ({
    role: "assistant",
    content:
        "Hey! I’m your AnimeVerse anime assistant. Ask me about characters, stories, power systems, watch order, recommendations, or tell me what you want to find in the AnimeVerse catalog.",
    provider: "AnimeVerse",
    systemStarter: true,
});

const QUICK_PROMPTS = [
    "Recommend a short anime for this weekend",
    "Explain Jujutsu Kaisen's power system without major spoilers",
    "Find Gojo videos in AnimeVerse",
    "Is Monster available in AnimeVerse?",
];

const providerLabel = (provider, usedCatalog) => {
    if (!provider) return "";
    if (provider.startsWith("gemini:")) {
        return usedCatalog ? "Gemini + AnimeVerse tools" : "Gemini anime expert";
    }
    if (provider.startsWith("ollama:")) {
        return usedCatalog ? "Local model + AnimeVerse tools" : "Local anime model";
    }
    if (provider === "local-retrieval") return "AnimeVerse local retrieval";
    if (provider === "local-conversation") return "AnimeVerse local fallback";
    return provider;
};

export default function AiChatPage() {
    const { user, loading: authLoading } = useAuth();
    const userId = user?._id || null;
    const storageKey = useMemo(() => animeChatSessionKey(userId), [userId]);

    const [messages, setMessages] = useState(() => [createStarter()]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [sources, setSources] = useState([]);
    const [hydratedKey, setHydratedKey] = useState(null);
    const lastSubmitted = useRef(null);
    const latestSessionRef = useRef({ messages, sources, input });
    const scrollYRef = useRef(0);

    useEffect(() => {
        latestSessionRef.current = { messages, sources, input };
    }, [messages, sources, input]);

    useEffect(() => {
        if (authLoading) return;

        setHydratedKey(null);
        const saved = loadAnimeChatSession(userId);
        const restoredMessages = saved?.messages?.length ? saved.messages : [createStarter()];

        setMessages(restoredMessages);
        setSources(saved?.sources || []);
        setInput(saved?.draft || "");
        setError("");
        setLoading(false);
        lastSubmitted.current = null;

        // Mark hydration after the state above is queued. This prevents the initial
        // starter render from overwriting a saved conversation before restoration.
        setHydratedKey(storageKey);

        if (saved?.scrollY) {
            requestAnimationFrame(() => {
                window.scrollTo({ top: saved.scrollY, behavior: "auto" });
            });
        }
    }, [authLoading, storageKey, userId]);

    const persistNow = useCallback(
        (scrollY = typeof window !== "undefined" ? window.scrollY : 0) => {
            if (authLoading || hydratedKey !== storageKey) return;
            const current = latestSessionRef.current;
            saveAnimeChatSession(userId, {
                messages: current.messages,
                sources: current.sources,
                draft: current.input,
                scrollY,
            });
        },
        [authLoading, hydratedKey, storageKey, userId]
    );

    useEffect(() => {
        if (authLoading || hydratedKey !== storageKey) return;
        persistNow();
    }, [messages, sources, input, authLoading, hydratedKey, storageKey, persistNow]);

    useEffect(() => {
        if (authLoading || hydratedKey !== storageKey) return undefined;

        const handleScroll = () => {
            scrollYRef.current = window.scrollY;
        };
        const handlePageHide = () => persistNow(scrollYRef.current || window.scrollY);

        scrollYRef.current = window.scrollY;
        window.addEventListener("scroll", handleScroll, { passive: true });
        window.addEventListener("pagehide", handlePageHide);

        return () => {
            persistNow(scrollYRef.current || window.scrollY);
            window.removeEventListener("scroll", handleScroll);
            window.removeEventListener("pagehide", handlePageHide);
        };
    }, [authLoading, hydratedKey, storageKey, persistNow]);

    const sessionReady = !authLoading && hydratedKey === storageKey;

    const submitMessage = async (content) => {
        const text = content.trim();
        if (!text || loading || !sessionReady) return;

        const conversation = [...messages, { role: "user", content: text }]
            .filter((message) => !message.systemStarter)
            .map(({ role, content: messageContent }) => ({ role, content: messageContent }))
            .slice(-11);

        setMessages((current) => [...current, { role: "user", content: text }]);
        setInput("");
        setError("");
        setLoading(true);
        setSources([]);
        lastSubmitted.current = text;

        try {
            const response = await aiService.chat(conversation);
            const data = response?.data?.data;
            setMessages((current) => [
                ...current,
                {
                    role: "assistant",
                    content: data?.answer || "I couldn't produce an answer this time.",
                    provider: data?.provider,
                    usedCatalog: Boolean(data?.usedCatalog),
                },
            ]);
            setSources(data?.sources || []);
        } catch (err) {
            setError(extractErrorMessage(err, "AnimeVerse Assistant is unavailable right now."));
        } finally {
            setLoading(false);
        }
    };

    const startNewChat = () => {
        clearAnimeChatSession(userId);
        setMessages([createStarter()]);
        setSources([]);
        setInput("");
        setError("");
        setLoading(false);
        lastSubmitted.current = null;
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const onSubmit = (event) => {
        event.preventDefault();
        submitMessage(input);
    };

    const hasConversation = messages.some((message) => !message.systemStarter) || Boolean(input.trim());

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <SectionHeader
                icon={Bot}
                title="AnimeVerse Assistant"
                subtitle="An anime expert that can also search your live AnimeVerse catalog when you need it."
                action={
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={startNewChat}
                        disabled={!sessionReady || !hasConversation || loading}
                        title="Start a fresh conversation"
                    >
                        <MessageSquarePlus className="h-4 w-4" /> New chat
                    </Button>
                }
            />

            <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted">
                    <Sparkles className="h-3.5 w-3.5 text-accent" /> General anime conversation
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted">
                    <Search className="h-3.5 w-3.5 text-accent" /> AnimeVerse catalog tools
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent" /> Spoiler-aware by default
                </span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-card/60">
                <div className="min-h-[440px] space-y-4 p-4 sm:p-6">
                    {!sessionReady && (
                        <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-muted">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Restoring your conversation...
                        </div>
                    )}

                    {sessionReady && messages.map((message, index) => {
                        const assistant = message.role === "assistant";
                        const label = assistant
                            ? providerLabel(message.provider, message.usedCatalog)
                            : "";

                        return (
                            <div
                                key={`${message.role}-${index}`}
                                className={`flex gap-3 ${assistant ? "justify-start" : "justify-end"}`}
                            >
                                {assistant && (
                                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-accent">
                                        <Sparkles className="h-4 w-4" />
                                    </span>
                                )}

                                <div className="max-w-[84%] space-y-1.5">
                                    <div
                                        className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                                            assistant
                                                ? "border border-white/5 bg-white/[0.04] text-white/90"
                                                : "bg-primary text-white"
                                        }`}
                                    >
                                        {message.content}
                                    </div>
                                    {label && index !== 0 && (
                                        <div className="px-2 text-[11px] text-muted/80">{label}</div>
                                    )}
                                </div>

                                {!assistant && (
                                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                                        <User className="h-4 w-4" />
                                    </span>
                                )}
                            </div>
                        );
                    })}

                    {sessionReady && messages.length === 1 && !loading && (
                        <div className="grid gap-2 pt-2 sm:grid-cols-2">
                            {QUICK_PROMPTS.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => submitMessage(prompt)}
                                    className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-left text-sm text-white/80 transition hover:border-primary/40 hover:bg-white/[0.05] hover:text-white"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    )}

                    {sessionReady && loading && (
                        <div className="flex items-center gap-3 text-sm text-muted">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-accent">
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            </span>
                            Thinking...
                        </div>
                    )}
                </div>

                {sources.length > 0 && (
                    <div className="border-t border-white/5 px-4 py-4 sm:px-6">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                            AnimeVerse catalog results used
                        </p>
                        <p className="mb-3 text-xs text-muted/70">
                            These cards come from stored AnimeVerse metadata. The assistant does not inspect YouTube media itself.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {sources.slice(0, 4).map((source) => (
                                <Link
                                    key={source.videoId}
                                    to={`/watch/${source.videoId}`}
                                    onClick={() => persistNow(scrollYRef.current || window.scrollY)}
                                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 transition hover:border-primary/40 hover:bg-white/[0.05]"
                                >
                                    <PlayCircle className="h-5 w-5 shrink-0 text-accent" />
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-white">
                                            {source.videoTitle}
                                        </div>
                                        <div className="truncate text-xs text-muted">
                                            {source.animeTitle || source.sourceType}
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="flex items-center justify-between gap-3 border-t border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-100 sm:px-6">
                        <span>{error}</span>
                        {lastSubmitted.current && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => submitMessage(lastSubmitted.current)}
                                disabled={loading}
                            >
                                Retry
                            </Button>
                        )}
                    </div>
                )}

                <form onSubmit={onSubmit} className="flex gap-3 border-t border-white/10 p-4 sm:p-5">
                    <textarea
                        value={input}
                        disabled={!sessionReady}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                if (input.trim()) submitMessage(input);
                            }
                        }}
                        rows={2}
                        maxLength={2000}
                        placeholder="Ask about anime, or say: Find me Gojo videos in AnimeVerse..."
                        className="min-h-[52px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition placeholder:text-muted/70 focus:border-primary/60"
                    />
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={!sessionReady || loading || !input.trim()}
                        className="self-end"
                    >
                        <Send className="h-4 w-4" /> Send
                    </Button>
                </form>
            </div>

            <p className="text-center text-xs text-muted">
                Your active chat is kept for this browser session while you move between AnimeVerse pages. New chat clears it intentionally.
            </p>
        </div>
    );
}
