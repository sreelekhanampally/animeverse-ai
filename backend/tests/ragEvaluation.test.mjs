import test from "node:test";
import assert from "node:assert/strict";
import { scoreRagCases } from "../src/utils/ragEvaluation.js";

test("Hit@K and citation coverage expose missed and unrelated retrieval", () => {
    const cases = [
        { query: "alchemy brothers", title: /Brotherhood/i },
        { query: "pirate crew", title: /One Piece/i },
        { query: "made-up finances", absent: true },
    ];
    const results = [
        { context: "[AV1] Brotherhood", sources: [{ citationId: "AV1", title: "Brotherhood" }] },
        { context: "[AV1] Naruto", sources: [{ citationId: "AV1", title: "Naruto" }] },
        { context: "[AV1] Irrelevant", sources: [{ citationId: "AV1", title: "Irrelevant" }] },
    ];
    const summary = scoreRagCases(cases, results, 3);
    assert.equal(summary.hitAtK, 0.5);
    assert.equal(summary.negativeEvidencePassed, false);
    assert.equal(summary.contextCitationCoverage, true);

    results[2] = { context: "", sources: [] };
    results[0].context = "";
    const changed = scoreRagCases(cases, results, 3);
    assert.equal(changed.negativeEvidencePassed, true);
    assert.equal(changed.contextCitationCoverage, false);
});
