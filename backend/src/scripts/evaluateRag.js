import "dotenv/config";
import connectDB, { disconnectDB } from "../db/index.js";
import { retrieveRagContext } from "../services/ragRetrieval.service.js";
import { RAG_EVAL_CASES, scoreRagCases } from "../utils/ragEvaluation.js";

try {
    await connectDB();
    const results = [];
    for (const item of RAG_EVAL_CASES) {
        results.push(await retrieveRagContext(item.query, { limit: 3 }));
    }
    console.log(JSON.stringify(scoreRagCases(RAG_EVAL_CASES, results, 3), null, 2));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await disconnectDB().catch(() => {});
}
