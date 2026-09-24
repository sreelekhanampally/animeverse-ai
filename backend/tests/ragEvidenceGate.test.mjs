import test from "node:test";
import assert from "node:assert/strict";
import { hasRagEvidence, lexicalCoverageScore } from "../src/utils/ragRanking.js";

test("semantic neighbours without a query anchor cannot ground an answer", () => {
    const unrelated = [
        { semanticScore: 0.478, score: 0.527, lexicalScore: 0 },
        { semanticScore: 0.452, score: 0.524, lexicalScore: 0 },
    ];
    assert.equal(hasRagEvidence(unrelated), false);
    assert.equal(hasRagEvidence([]), false);
});

test("a relevant selected chunk keeps the context available", () => {
    const selected = [
        { semanticScore: 0.239, lexicalScore: 0.375 },
        { semanticScore: 0.203, lexicalScore: 0 },
    ];
    assert.equal(hasRagEvidence(selected), true);
});

test("whole tokens prevent PIN from matching opening or pink", () => {
    const score = lexicalCoverageScore("reset my bank PIN", {
        title: "Opening of Pink Moon",
        content: "A bank gamble",
    });
    assert.equal(score, 0.333333);
});

test("weak topic overlap and low semantic similarity each cause abstention", () => {
    assert.equal(hasRagEvidence([{ lexicalScore: 0.2, semanticScore: 0.211 }]), false);
    assert.equal(hasRagEvidence([{ lexicalScore: 0.667, semanticScore: 0.099 }]), false);
    assert.equal(hasRagEvidence([{ lexicalScore: 0.375, semanticScore: 0.239 }]), true);
});
