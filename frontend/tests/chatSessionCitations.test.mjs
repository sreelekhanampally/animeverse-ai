import test from "node:test";
import assert from "node:assert/strict";
import { loadAnimeChatSession, saveAnimeChatSession } from "../src/utils/chatSession.js";

test("cited chunks survive chat session restore without retaining arbitrary metadata", () => {
    const values = new Map();
    globalThis.window = {
        sessionStorage: {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
        },
    };
    try {
        saveAnimeChatSession("user-1", {
            messages: [{
                role: "assistant",
                content: "The brothers seek the stone [AV1].",
                citations: [{
                    citationId: "AV1",
                    title: "Brotherhood synopsis",
                    excerpt: "Two brothers seek a stone.",
                    animeId: "anime-1",
                    score: 0.92,
                }],
            }],
        });
        const [message] = loadAnimeChatSession("user-1").messages;
        assert.equal(message.citations[0].title, "Brotherhood synopsis");
        assert.equal(message.citations[0].animeId, "anime-1");
        assert.equal("score" in message.citations[0], false);
    } finally {
        delete globalThis.window;
    }
});
