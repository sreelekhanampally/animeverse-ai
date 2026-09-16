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
    Mic,
    MicOff,
    Volume2,
    VolumeX,
    Square,
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
import {
    browserVoiceCapabilities,
    createSpeechRecognizer,
    speakText,
    speechRecognitionErrorMessage,
    stopSpeaking,
} from "@/utils/browserVoice";

const VOICE_LANGUAGE = "en-US";

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
    const voiceCapabilities = useMemo(() => browserVoiceCapabilities(), []);

    const [messages, setMessages] = useState(() => [createStarter()]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [sources, setSources] = useState([]);
    const [hydratedKey, setHydratedKey] = useState(null);
    const [voiceMode, setVoiceMode] = useState(false);
    const [listening, setListening] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState("");
    const [voiceError, setVoiceError] = useState("");
    const [speakingIndex, setSpeakingIndex] = useState(null);

    const lastSubmitted = useRef(null);
    const latestSessionRef = useRef({ messages, sources, input, voiceMode });
    const scrollYRef = useRef(0);
    const recognitionRef = useRef(null);
    const speechTokenRef = useRef(0);

    useEffect(() => {
        latestSessionRef.current = { messages, sources, input, voiceMode };
    }, [messages, sources, input, voiceMode]);

    useEffect(() => {
        if (authLoading) return;

        setHydratedKey(null);
        const saved = loadAnimeChatSession(userId);
        const restoredMessages = saved?.messages?.length ? saved.messages : [createStarter()];

        setMessages(restoredMessages);
        setSources(saved?.sources || []);
        setInput(saved?.draft || "");
        setVoiceMode(Boolean(saved?.voiceMode));
        setError("");
        setVoiceError("");
        setLoading(false);
        setListening(false);
        setSpeakingIndex(null);
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
                voiceMode: current.voiceMode,
                scrollY,
            });
        },
        [authLoading, hydratedKey, storageKey, userId]
    );

    useEffect(() => {
        if (authLoading || hydratedKey !== storageKey) return;
        persistNow();
    }, [messages, sources, input, voiceMode, authLoading, hydratedKey, storageKey, persistNow]);

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

    useEffect(
        () => () => {
            try {
                recognitionRef.current?.abort?.();
            } catch {
                // Recognition may already have ended.
            }
            stopSpeaking();
        },
        []
    );

    const sessionReady = !authLoading && hydratedKey === storageKey;

    const stopVoiceOutput = useCallback(() => {
        speechTokenRef.current += 1;
        stopSpeaking();
        setSpeakingIndex(null);
    }, []);

    const speakAssistant = useCallback(
        (text, index = null) => {
            if (!voiceCapabilities.synthesis) {
                setVoiceError("Spoken replies are not supported by this browser.");
                return;
            }

            setVoiceError("");
            const token = speechTokenRef.current + 1;
            speechTokenRef.current = token;
            const utterance = speakText(text, {
                language: VOICE_LANGUAGE,
                onStart: () => {
                    if (speechTokenRef.current === token) setSpeakingIndex(index ?? "manual");
                },
                onEnd: () => {
                    if (speechTokenRef.current === token) setSpeakingIndex(null);
                },
                onError: () => {
                    if (speechTokenRef.current !== token) return;
                    setSpeakingIndex(null);
                    setVoiceError("The browser could not play this reply aloud. The text answer is still available.");
                },
            });

            if (!utterance) {
                setSpeakingIndex(null);
                setVoiceError("The browser could not start speech playback.");
            }
        },
        [voiceCapabilities.synthesis]
    );

    const submitMessage = async (content, { fromVoice = false } = {}) => {
        const text = content.trim();
        if (!text || loading || !sessionReady) return;

        if (fromVoice) setVoiceMode(true);

        const conversation = [...messages, { role: "user", content: text }]
            .filter((message) => !message.systemStarter)
            .map(({ role, content: messageContent }) => ({ role, content: messageContent }))
            .slice(-11);

        const assistantIndex = messages.length + 1;

        setMessages((current) => [...current, { role: "user", content: text }]);
        setInput("");
        setInterimTranscript("");
        setError("");
        setVoiceError("");
        setLoading(true);
        setSources([]);
        lastSubmitted.current = text;

        try {
            const response = await aiService.chat(conversation);
            const data = response?.data?.data;
            const answer = data?.answer || "I couldn't produce an answer this time.";

            setMessages((current) => [
                ...current,
                {
                    role: "assistant",
                    content: answer,
                    provider: data?.provider,
                    usedCatalog: Boolean(data?.usedCatalog),
                },
            ]);
            setSources(data?.sources || []);

            if (voiceMode || fromVoice) {
                speakAssistant(answer, assistantIndex);
            }
        } catch (err) {
            setError(extractErrorMessage(err, "AnimeVerse Assistant is unavailable right now."));
        } finally {
            setLoading(false);
        }
    };

    const stopListening = useCallback(() => {
        try {
            recognitionRef.current?.stop?.();
        } catch {
            // Ignore duplicate stop calls from browser event races.
        }
    }, []);

    const startListening = () => {
        if (!sessionReady || loading) return;
        if (!voiceCapabilities.recognition) {
            setVoiceError("Voice input is not supported by this browser. Try Chrome or Edge, or keep typing normally.");
            return;
        }

        stopVoiceOutput();
        setVoiceError("");
        setInterimTranscript("");
        setVoiceMode(true);

        let submitted = false;
        const recognition = createSpeechRecognizer({
            language: VOICE_LANGUAGE,
            onStart: () => setListening(true),
            onInterim: (text) => {
                setInterimTranscript(text);
                setInput(text);
            },
            onFinal: (text) => {
                if (submitted) return;
                submitted = true;
                setInterimTranscript("");
                setInput("");
                submitMessage(text, { fromVoice: true });
            },
            onEnd: () => {
                setListening(false);
                recognitionRef.current = null;
            },
            onError: (code) => {
                setListening(false);
                recognitionRef.current = null;
                const message = speechRecognitionErrorMessage(code);
                if (message) setVoiceError(message);
            },
        });

        if (!recognition) {
            setVoiceError("Voice input is not supported by this browser.");
            return;
        }

        recognitionRef.current = recognition;
        try {
            recognition.start();
        } catch {
            recognitionRef.current = null;
            setListening(false);
            setVoiceError("The microphone could not start. Wait a moment and try again.");
        }
    };

    const toggleListening = () => {
        if (listening) stopListening();
        else startListening();
    };

    const toggleVoiceMode = () => {
        if (!voiceCapabilities.synthesis) {
            setVoiceError("Spoken replies are not supported by this browser.");
            return;
        }

        setVoiceMode((current) => {
            const next = !current;
            if (!next) stopVoiceOutput();
            return next;
        });
        setVoiceError("");
    };

    const startNewChat = () => {
        try {
            recognitionRef.current?.abort?.();
        } catch {
            // Recognition may already have ended.
        }
        recognitionRef.current = null;
        setListening(false);
        setInterimTranscript("");
        stopVoiceOutput();
        clearAnimeChatSession(userId);
        setMessages([createStarter()]);
        setSources([]);
        setInput("");
        setError("");
        setVoiceError("");
        setLoading(false);
        lastSubmitted.current = null;
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const onSubmit = (event) => {
        event.preventDefault();
        submitMessage(input);
    };

    const hasConversation = messages.some((message) => !message.systemStarter) || Boolean(input.trim());
    const voiceStatus = listening
        ? `Listening${interimTranscript ? `: ${interimTranscript}` : "…"}`
        : speakingIndex !== null
          ? "Speaking reply…"
          : "";

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
                <button
                    type="button"
                    onClick={toggleVoiceMode}
                    disabled={!voiceCapabilities.synthesis}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                        voiceMode
                            ? "border-primary/50 bg-primary/15 text-white"
                            : "border-white/10 bg-white/[0.04] text-muted hover:border-white/20 hover:text-white"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    aria-pressed={voiceMode}
                    title={
                        voiceCapabilities.synthesis
                            ? "Toggle automatic spoken assistant replies"
                            : "Speech playback is unavailable in this browser"
                    }
                >
                    {voiceMode ? (
                        <Volume2 className="h-3.5 w-3.5 text-accent" />
                    ) : (
                        <VolumeX className="h-3.5 w-3.5" />
                    )}
                    Voice replies {voiceMode ? "on" : "off"}
                </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-card/60">
                <div className="min-h-[440px] space-y-4 p-4 sm:p-6">
                    {!sessionReady && (
                        <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-muted">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Restoring your conversation...
                        </div>
                    )}

                    {sessionReady &&
                        messages.map((message, index) => {
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

                                        {assistant && !message.systemStarter && (
                                            <div className="flex items-center justify-between gap-3 px-2">
                                                <div className="text-[11px] text-muted/80">{label}</div>
                                                {voiceCapabilities.synthesis && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (speakingIndex === index) stopVoiceOutput();
                                                            else speakAssistant(message.content, index);
                                                        }}
                                                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted transition hover:bg-white/[0.05] hover:text-white"
                                                        title={speakingIndex === index ? "Stop speaking" : "Read this answer aloud"}
                                                        aria-label={speakingIndex === index ? "Stop speaking" : "Read answer aloud"}
                                                    >
                                                        {speakingIndex === index ? (
                                                            <Square className="h-3 w-3 fill-current" />
                                                        ) : (
                                                            <Volume2 className="h-3.5 w-3.5" />
                                                        )}
                                                        {speakingIndex === index ? "Stop" : "Listen"}
                                                    </button>
                                                )}
                                            </div>
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

                {(voiceStatus || voiceError) && (
                    <div
                        className={`flex items-center gap-2 border-t px-4 py-2.5 text-xs sm:px-6 ${
                            voiceError
                                ? "border-amber-300/15 bg-amber-300/5 text-amber-100"
                                : "border-cyan-300/10 bg-cyan-300/5 text-cyan-100"
                        }`}
                    >
                        {listening ? (
                            <Mic className="h-3.5 w-3.5 animate-pulse" />
                        ) : speakingIndex !== null ? (
                            <Volume2 className="h-3.5 w-3.5" />
                        ) : (
                            <MicOff className="h-3.5 w-3.5" />
                        )}
                        <span>{voiceError || voiceStatus}</span>
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

                <form onSubmit={onSubmit} className="flex gap-2 border-t border-white/10 p-4 sm:gap-3 sm:p-5">
                    <Button
                        type="button"
                        variant={listening ? "primary" : "ghost"}
                        onClick={toggleListening}
                        disabled={!sessionReady || loading || !voiceCapabilities.recognition}
                        className="self-end"
                        title={
                            voiceCapabilities.recognition
                                ? listening
                                    ? "Stop listening"
                                    : "Speak to AnimeVerse Assistant"
                                : "Voice input is unavailable in this browser"
                        }
                        aria-label={listening ? "Stop listening" : "Start voice input"}
                        aria-pressed={listening}
                    >
                        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>

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
                        placeholder={
                            listening
                                ? "Listening… speak naturally"
                                : "Ask about anime, or say: Find me Gojo videos in AnimeVerse..."
                        }
                        className="min-h-[52px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition placeholder:text-muted/70 focus:border-primary/60"
                    />
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={!sessionReady || loading || listening || !input.trim()}
                        className="self-end"
                    >
                        <Send className="h-4 w-4" /> Send
                    </Button>
                </form>
            </div>

            <p className="text-center text-xs text-muted">
                Your active chat is kept for this browser session. Voice input uses your browser microphone service; spoken replies use your device voices. You can always type instead.
            </p>
        </div>
    );
}
