# AnimeVerse AI Evaluation & Observability Upgrade

## Goal

This phase turns AnimeVerse AI from a feature demo into a measurable AI system. The new dashboard reports corpus health, embedding coverage, retrieval quality, runtime latency, assistant provider usage, catalogue tool activity, and a repeatable semantic-search benchmark.

No new paid service, vector database, analytics vendor, or runtime dependency was added.

## 1. New AI Evaluation dashboard

New public page:

`/ai/evaluation`

The sidebar now includes **AI Evaluation** under the AI section.

The page shows:

- published video count and media-source breakdown,
- Video embedding coverage,
- Anime embedding coverage,
- active embedding provider/model/dimensions/version,
- whether the local embedding runtime is already warm in the current process,
- Gemini configuration and fallback model chain,
- observed AI operation counts,
- success rate,
- p50 latency,
- p95 latency,
- observed chat provider distribution,
- AnimeVerse catalogue tool-call count,
- catalogue-grounded chat count,
- the latest retrieval benchmark.

The dashboard is intentionally sanitized. It does not expose API keys, embedding arrays, prompt internals, JWTs, private user data, or model-cache paths.

## 2. Runtime observability

New service:

`backend/src/services/aiObservability.service.js`

It records lightweight in-process metrics for AI operations including:

- semantic search,
- assistant chat,
- similar-video retrieval,
- semantic discovery graph,
- dynamic collections.

Each operation tracks:

- request count,
- success count,
- failure count,
- success rate,
- a bounded recent latency sample,
- p50 latency,
- p95 latency,
- last request time,
- last failure time and safe error code.

For assistant traffic it additionally tracks:

- which providers actually answered requests,
- total AnimeVerse tool calls,
- catalogue-grounded chat turns.

### Important runtime characteristic

These telemetry counters are deliberately in-memory. They reset when the Node backend restarts. The dashboard labels this explicitly so process-local telemetry is never presented as permanent historical analytics.

This choice keeps the interview project infrastructure simple while still demonstrating real observability design. A later production-hardening phase can persist or export these metrics if desired.

## 3. Semantic retrieval benchmark

New service:

`backend/src/services/aiEvaluation.service.js`

The dashboard includes a manual **Run retrieval benchmark** action. It runs a small curated benchmark through the real AnimeVerse semantic retrieval path:

query -> local MiniLM query embedding -> MongoDB candidate vectors -> hybrid ranking -> Top-K results

The benchmark currently contains eight stable intents covering examples such as:

- Fullmetal Alchemist and alchemy brothers,
- One Piece and pirate treasure discovery,
- Attack on Titan and walled-city giants,
- Haikyu and high-school volleyball,
- Steins;Gate and time-travel experiments,
- Death Note and the deadly notebook,
- Jujutsu Kaisen and cursed-energy sorcerers,
- Demon Slayer and the transformed sister.

Expected titles that are not currently present in the catalogue are marked unavailable and excluded from accuracy calculations rather than incorrectly counted as model failures.

The benchmark reports:

- **Top-1 accuracy**
- **Recall@5**
- **MRR** (mean reciprocal rank)
- **p50 retrieval latency**
- **p95 retrieval latency**
- per-query expected title,
- actual top hit,
- rank of the expected anime,
- query latency,
- Top-1 / Top-5 / miss status.

The benchmark execution endpoint is separately limited to four runs per IP per hour because it performs multiple real embedding/search passes.

## 4. New backend endpoints

### GET `/api/v1/ai/evaluation`

Returns the current sanitized evaluation snapshot:

- catalogue counts,
- vector coverage,
- embedding identity,
- assistant provider configuration,
- process-local runtime telemetry,
- latest benchmark result if one has been run during this process.

### POST `/api/v1/ai/evaluation/run`

Runs the curated retrieval benchmark and returns the refreshed evaluation snapshot.

This endpoint does not call Gemini or a paid API. It uses the local embedding provider and the current MongoDB catalogue.

## 5. Embedding coverage validation

Coverage is not calculated merely from `embedding.length > 0`.

A document counts as compatible only when its stored provenance matches the active embedding identity:

- active model,
- active dimension count,
- active embedding version,
- expected vector length.

This prevents old 32-dimensional pseudo-vectors or 1536-dimensional OpenAI-era vectors from inflating the dashboard's coverage number.

## 6. Assistant observability

Assistant requests now feed safe runtime telemetry after completion.

For successful Gemini turns the assistant also reports the number of function calls internally to the observability layer. This lets the dashboard distinguish ordinary anime conversation from catalogue-grounded tool use without exposing tool payloads or private conversation content.

No chat message text is stored by the observability service.

## 7. Frontend integration

New file:

`frontend/src/pages/AiEvaluationPage.jsx`

Modified:

- `frontend/src/routes/paths.js`
- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/layouts/Sidebar.jsx`
- `frontend/src/services/index.js`

The page auto-refreshes the lightweight snapshot every ten seconds. Running the benchmark remains manual.

No charting dependency was added. The dashboard uses the existing React/Tailwind stack and compact tables, status pills, coverage bars, and metric cards.

## 8. Safety and privacy boundaries

The evaluation feature does not return:

- embedding arrays,
- embedding hashes,
- API keys,
- JWTs,
- conversation text,
- private user activity records,
- internal system prompts.

It reports aggregate system state and safe provider/model names only.

## 9. Files changed

### New

- `backend/src/services/aiObservability.service.js`
- `backend/src/services/aiEvaluation.service.js`
- `backend/tests/aiEvaluation.test.mjs`
- `frontend/src/pages/AiEvaluationPage.jsx`
- `AI_EVALUATION_OBSERVABILITY_REPORT.md`

### Modified

- `backend/src/controllers/ai.controller.js`
- `backend/src/routes/ai.routes.js`
- `backend/src/services/animeAssistant.service.js`
- `frontend/src/services/index.js`
- `frontend/src/routes/paths.js`
- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/layouts/Sidebar.jsx`

## 10. Verification performed

### New evaluation tests

5 passed, 0 failed.

They verify:

- stable benchmark definitions,
- Top-1 / Recall@5 / MRR calculations,
- latency percentile calculations,
- runtime telemetry accounting,
- provider/tool-call accounting,
- public snapshot route wiring,
- separate benchmark rate limiting,
- frontend dashboard wiring,
- no embedding-array exposure in the UI.

### Complete backend suite

`188 tests discovered`

`181 passed`

`0 failed`

`7 skipped`

The seven skips are the existing optional/live local-model tests in this Linux execution environment.

### Additional verification

- every changed backend JavaScript module passed `node --check`,
- the complete backend app/router imported successfully,
- all changed React/JSX files parsed successfully,
- all Lucide icons used by the new page exist in the installed dependency version.

### Frontend production build limitation in this environment

The uploaded project contains Windows-native Rollup dependencies. This execution environment is Linux, so Vite cannot load `@rollup/rollup-linux-x64-gnu` from the copied Windows `node_modules` tree. The failure occurs inside Rollup before application compilation.

Run the final production build on the real Windows checkout:

```powershell
cd C:\Users\nsree\Desktop\animeverse-ai\frontend
npm run build
```

## 11. Interview value

This feature gives a concrete answer to questions such as:

- How do you know your semantic search is working?
- How do you measure retrieval quality?
- What happens when embeddings become stale?
- What are your p50 and p95 latencies?
- Which chat provider actually answered requests?
- How often does the assistant use catalogue tools?
- How much of your corpus is actually searchable?
- How do you prevent old incompatible vectors from polluting metrics?

That moves AnimeVerse from "AI features were integrated" toward "the AI system is observable and evaluated."
