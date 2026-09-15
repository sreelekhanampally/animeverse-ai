import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    generateGeminiChat,
    geminiConfig,
    toGeminiContents,
    ANIMEVERSE_TOOL_DECLARATIONS,
    GeminiChatError,
} from "../src/services/geminiChat.provider.js";

const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_API_BASE: process.env.GEMINI_API_BASE,
    GEMINI_FALLBACK_MODELS: process.env.GEMINI_FALLBACK_MODELS,
};

const restoreEnv = () => {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
    }
};

test.afterEach(restoreEnv);

const jsonResponse = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
        return payload;
    },
});

test("Gemini config defaults to the free-tier Flash model and never exposes a key", () => {
    process.env.GEMINI_API_KEY = "secret-test-key";
    delete process.env.GEMINI_MODEL;
    const config = geminiConfig();
    assert.equal(config.configured, true);
    assert.equal(config.model, "gemini-3.7-flash");
    assert.deepEqual(config.fallbackModels, ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]);
    assert.equal(Object.values(config).includes("secret-test-key"), false);
});

test("conversation history maps assistant turns to Gemini model role", () => {
    assert.deepEqual(
        toGeminiContents([
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
            { role: "user", content: "tell me about Naruto" },
        ]),
        [
            { role: "user", parts: [{ text: "hi" }] },
            { role: "model", parts: [{ text: "hello" }] },
            { role: "user", parts: [{ text: "tell me about Naruto" }] },
        ]
    );
});

test("tool descriptions tell Gemini not to search AnimeVerse for greetings", () => {
    const searchTool = ANIMEVERSE_TOOL_DECLARATIONS.find(
        (tool) => tool.name === "search_animeverse_catalog"
    );
    assert.ok(searchTool);
    assert.match(searchTool.description, /Do not call it for greetings/i);
});

test("a direct Gemini answer needs one request and no catalogue tool", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const requests = [];
    const fetchImpl = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return jsonResponse({
            candidates: [{ content: { role: "model", parts: [{ text: "Hey! What anime are you into?" }] } }],
        });
    };

    let toolCalls = 0;
    const result = await generateGeminiChat({
        messages: [{ role: "user", content: "hi" }],
        executeTool: async () => {
            toolCalls += 1;
            return {};
        },
        fetchImpl,
        allowTools: false,
    });

    assert.equal(result.answer, "Hey! What anime are you into?");
    assert.match(result.provider, /^gemini:/);
    assert.equal(toolCalls, 0);
    assert.equal(requests.length, 1);
    assert.equal("tools" in requests[0], false, "casual turns should not expose catalogue tools");
    assert.match(requests[0].systemInstruction.parts[0].text, /respond socially and do not mention random anime/i);
});

test("Gemini native function calling round-trips the matching call id", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const requests = [];
    const responses = [
        {
            candidates: [
                {
                    content: {
                        role: "model",
                        parts: [
                            {
                                functionCall: {
                                    id: "call-123",
                                    name: "search_animeverse_catalog",
                                    args: { query: "Gojo", limit: 4 },
                                },
                            },
                        ],
                    },
                },
            ],
        },
        {
            candidates: [
                {
                    content: {
                        role: "model",
                        parts: [{ text: "I found a few Gojo-related AnimeVerse videos." }],
                    },
                },
            ],
        },
    ];

    const fetchImpl = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return jsonResponse(responses.shift());
    };

    const toolArgs = [];
    const result = await generateGeminiChat({
        messages: [{ role: "user", content: "Find Gojo videos in AnimeVerse" }],
        executeTool: async (name, args) => {
            toolArgs.push({ name, args });
            return {
                videos: [{ title: "Gojo clip" }],
                sources: [{ videoId: "v1", videoTitle: "Gojo clip" }],
            };
        },
        fetchImpl,
    });

    assert.equal(toolArgs.length, 1);
    assert.equal(toolArgs[0].name, "search_animeverse_catalog");
    assert.equal(result.toolEvents.length, 1);
    assert.equal(requests.length, 2);

    const fnResponse = requests[1].contents.at(-1).parts[0].functionResponse;
    assert.equal(fnResponse.id, "call-123");
    assert.equal(fnResponse.name, "search_animeverse_catalog");
    assert.equal(fnResponse.response.result.videos[0].title, "Gojo clip");
});



test("a throttled primary model fails over to a free Flash-Lite model", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const urls = [];
    const fetchImpl = async (url) => {
        urls.push(String(url));
        if (urls.length === 1) {
            return jsonResponse({ error: { message: "quota exceeded" } }, 429);
        }
        return jsonResponse({
            candidates: [{ content: { role: "model", parts: [{ text: "Try Erased if you want a short thriller." }] } }],
        });
    };

    const result = await generateGeminiChat({
        messages: [{ role: "user", content: "Recommend me a short anime" }],
        executeTool: async () => ({}),
        fetchImpl,
        allowTools: false,
    });

    assert.equal(urls.length, 2);
    assert.match(urls[0], /gemini-3\.7-flash/);
    assert.match(urls[1], /gemini-3\.1-flash-lite/);
    assert.equal(result.provider, "gemini:gemini-3.1-flash-lite");
});

test("general anime recommendations do not expose catalogue tools", async () => {
    const source = await readFile(
        new URL("../src/services/animeAssistant.service.js", import.meta.url),
        "utf8"
    );
    assert.match(source, /allowTools:\s*likelyNeedsCatalog\(latestQuestion\)/);
    assert.doesNotMatch(source, /allowTools:\s*!isCasualChatMessage\(latestQuestion\)/);
});

test("Gemini 429 is converted to a controlled free-tier quota error", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchImpl = async () =>
        jsonResponse({ error: { message: "quota exceeded" } }, 429);

    await assert.rejects(
        () =>
            generateGeminiChat({
                messages: [{ role: "user", content: "hello" }],
                executeTool: async () => ({}),
                fetchImpl,
            }),
        (error) => {
            assert.ok(error instanceof GeminiChatError);
            assert.equal(error.code, "GEMINI_QUOTA_EXHAUSTED");
            assert.equal(error.statusCode, 503);
            return true;
        }
    );
});

test("Anime Assistant V2 keeps Gemini server-side and retains zero-cost fallbacks", async () => {
    const source = await readFile(
        new URL("../src/services/animeAssistant.service.js", import.meta.url),
        "utf8"
    );
    const envSample = await readFile(new URL("../.env.sample", import.meta.url), "utf8");

    assert.match(source, /generateGeminiChat/);
    assert.match(source, /localFallback/);
    assert.match(source, /hasConfiguredOllamaModel/);
    assert.match(envSample, /GEMINI_API_KEY=/);
    assert.match(envSample, /GEMINI_MODEL=gemini-3\.7-flash/);
});

test("the chat UI no longer claims every answer is constrained to retrieved metadata", async () => {
    const source = await readFile(
        new URL("../../frontend/src/pages/AiChatPage.jsx", import.meta.url),
        "utf8"
    );
    assert.match(source, /General anime conversation/);
    assert.match(source, /AnimeVerse catalog tools/);
    assert.doesNotMatch(source, /Answers are constrained to AnimeVerse metadata/);
});

test("semantic retrieval window covers the 1k+ catalogue target", async () => {
    const searchSource = await readFile(
        new URL("../src/services/semanticSearch.service.js", import.meta.url),
        "utf8"
    );
    const controllerSource = await readFile(
        new URL("../src/controllers/ai.controller.js", import.meta.url),
        "utf8"
    );
    assert.match(searchSource, /maxCandidates = 1500/);
    assert.match(controllerSource, /\.limit\(1500\)/);
});

test("local emergency fallback never semantic-searches a simple greeting", async () => {
    const previousMode = process.env.ANIME_CHAT_PROVIDER;
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.ANIME_CHAT_PROVIDER = "retrieval";
    delete process.env.GEMINI_API_KEY;
    try {
        const { answerAnimeChat } = await import("../src/services/animeAssistant.service.js");
        const result = await answerAnimeChat([{ role: "user", content: "hi" }]);
        assert.equal(result.provider, "local-conversation");
        assert.equal(result.usedCatalog, false);
        assert.deepEqual(result.sources, []);
        assert.match(result.answer, /anime assistant/i);
    } finally {
        if (previousMode == null) delete process.env.ANIME_CHAT_PROVIDER;
        else process.env.ANIME_CHAT_PROVIDER = previousMode;
        if (previousKey == null) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
    }
});
