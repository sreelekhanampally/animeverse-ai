import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getRagIndexStatus } from "../services/ragIndex.service.js";
import { retrieveRagKnowledge } from "../services/ragRetrieval.service.js";
import { buildRagContext } from "../services/ragContext.service.js";
import { recordAiOperation } from "../services/aiObservability.service.js";

const allowedSourceTypes = new Set(["anime", "video", "creator_transcript"]);

const parseSourceTypes = (value) => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item || "").trim()).filter((item) => allowedSourceTypes.has(item)))];
};

export const ragStatus = asyncHandler(async (_req, res) => {
    const status = await getRagIndexStatus();
    return res.json(new ApiResponse(200, status, "RAG index status"));
});

export const ragRetrieve = asyncHandler(async (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (query.length < 2 || query.length > 500) {
        throw new ApiError(400, "query must contain between 2 and 500 characters");
    }

    const rawLimit = req.body?.limit == null ? 8 : Number(req.body.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 12) {
        throw new ApiError(400, "limit must be an integer between 1 and 12");
    }

    const sourceTypes = parseSourceTypes(req.body?.sourceTypes);
    const startedAt = performance.now();

    try {
        const retrieval = await retrieveRagKnowledge(query, {
            limit: rawLimit,
            sourceTypes,
        });
        const context = buildRagContext(retrieval.results);

        recordAiOperation("ragRetrieve", {
            durationMs: performance.now() - startedAt,
            success: true,
        });

        return res.json(
            new ApiResponse(
                200,
                {
                    query,
                    results: retrieval.results,
                    context: context.context,
                    evidence: context.evidence,
                    diagnostics: {
                        ...retrieval.diagnostics,
                        ...context.diagnostics,
                    },
                },
                "RAG retrieval complete"
            )
        );
    } catch (error) {
        recordAiOperation("ragRetrieve", {
            durationMs: performance.now() - startedAt,
            success: false,
            errorCode: error?.code || error?.name || "RAG_RETRIEVAL_ERROR",
        });
        throw error;
    }
});
