import test from "node:test";
import assert from "node:assert/strict";
import { citedSources } from "../src/utils/ragCitations.js";

test("shows only retrieved sources the assistant actually cited, in answer order", () => {
    const citations = [
        { citationId: "AV1", title: "Brotherhood synopsis" },
        { citationId: "AV2", title: "Trailer metadata" },
        { citationId: "AV3", title: "Unrelated result" },
    ];
    assert.deepEqual(
        citedSources("The trailer [AV2] follows the synopsis [AV1]. Also [AV2].", citations),
        [citations[1], citations[0]]
    );
});

test("does not display invented citation ids or uncited retrieval results", () => {
    assert.deepEqual(citedSources("I don't have enough evidence [AV9].", [{ citationId: "AV1" }]), []);
    assert.deepEqual(citedSources("No citation here.", [{ citationId: "AV1" }]), []);
    assert.deepEqual(citedSources("[AV1]", null), []);
});
