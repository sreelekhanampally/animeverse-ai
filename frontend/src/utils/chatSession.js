const CHAT_SESSION_VERSION = 1;
const CHAT_SESSION_PREFIX = "animeverse:ai-chat";
const MAX_MESSAGES = 40;
const MAX_SOURCES = 8;

const canUseSessionStorage = () =>
    typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

const cleanText = (value, maxLength = 8000) =>
    typeof value === "string" ? value.slice(0, maxLength) : "";

const sanitizeMessages = (messages) => {
    if (!Array.isArray(messages)) return [];

    return messages
        .filter((message) => message && ["user", "assistant"].includes(message.role))
        .map((message) => ({
            role: message.role,
            content: cleanText(message.content),
            provider: cleanText(message.provider, 120) || undefined,
            usedCatalog: Boolean(message.usedCatalog),
            systemStarter: Boolean(message.systemStarter),
        }))
        .filter((message) => message.content.trim())
        .slice(-MAX_MESSAGES);
};

const sanitizeSources = (sources) => {
    if (!Array.isArray(sources)) return [];

    return sources
        .filter((source) => source && source.videoId)
        .map((source) => ({
            videoId: cleanText(String(source.videoId), 128),
            videoTitle: cleanText(source.videoTitle, 500),
            animeTitle: cleanText(source.animeTitle, 500),
            sourceType: cleanText(source.sourceType, 64),
        }))
        .slice(0, MAX_SOURCES);
};

export const animeChatSessionKey = (userId) =>
    `${CHAT_SESSION_PREFIX}:v${CHAT_SESSION_VERSION}:${userId ? `user:${userId}` : "guest"}`;

export const loadAnimeChatSession = (userId) => {
    if (!canUseSessionStorage()) return null;

    try {
        const raw = window.sessionStorage.getItem(animeChatSessionKey(userId));
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== CHAT_SESSION_VERSION) return null;

        return {
            messages: sanitizeMessages(parsed.messages),
            sources: sanitizeSources(parsed.sources),
            draft: cleanText(parsed.draft, 2000),
            scrollY: Number.isFinite(parsed.scrollY) ? Math.max(0, parsed.scrollY) : 0,
            updatedAt: cleanText(parsed.updatedAt, 64),
        };
    } catch {
        return null;
    }
};

export const saveAnimeChatSession = (userId, session) => {
    if (!canUseSessionStorage()) return;

    try {
        window.sessionStorage.setItem(
            animeChatSessionKey(userId),
            JSON.stringify({
                version: CHAT_SESSION_VERSION,
                messages: sanitizeMessages(session?.messages),
                sources: sanitizeSources(session?.sources),
                draft: cleanText(session?.draft, 2000),
                scrollY: Number.isFinite(session?.scrollY) ? Math.max(0, session.scrollY) : 0,
                updatedAt: new Date().toISOString(),
            })
        );
    } catch {
        // Storage can be unavailable in private/restricted browser contexts.
        // Chat must still continue in memory rather than fail because persistence failed.
    }
};

export const clearAnimeChatSession = (userId) => {
    if (!canUseSessionStorage()) return;

    try {
        window.sessionStorage.removeItem(animeChatSessionKey(userId));
    } catch {
        // Ignore browser storage failures during logout/new-chat cleanup.
    }
};
