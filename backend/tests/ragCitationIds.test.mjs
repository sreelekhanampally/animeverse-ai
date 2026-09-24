import test from "node:test";
import assert from "node:assert/strict";
import { renumberKnowledgeResult } from "../src/utils/ragCitationIds.js";

test("successive knowledge searches get distinct source ids in context and response", () => {
    const first = renumberKnowledgeResult({
        context: "[AV1] First source",
        knowledgeSources: [{ citationId: "AV1", title: "First source" }],
    });
    const second = renumberKnowledgeResult({
        context: "[AV1] Second source and [AV2] another source",
        knowledgeSources: [
            { citationId: "AV1", title: "Second source" },
            { citationId: "AV2", title: "Another source" },
        ],
    }, first.nextOffset);

    assert.equal(first.result.knowledgeSources[0].citationId, "AV1");
    assert.deepEqual(second.result.knowledgeSources.map((source) => source.citationId), ["AV2", "AV3"]);
    assert.match(second.result.context, /\[AV2\] Second source and \[AV3\]/);
    assert.equal(second.nextOffset, 3);
});
