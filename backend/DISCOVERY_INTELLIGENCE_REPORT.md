# AnimeVerse Discovery Intelligence Upgrade

## Goal

This pass does not add another chatbot. AnimeVerse already has a Gemini-powered AI companion and local MiniLM semantic search. This upgrade makes the rest of the product feel AI-native by turning the existing embedding corpus into visible discovery features recruiters can inspect and users can interact with.

## 1. Semantic “More like this” on WatchPage

### New API

- `GET /api/v1/ai/videos/:videoId/similar?limit=10`

### How it works

The current video’s stored 384-dimensional MiniLM embedding is compared against published, compatible video embeddings. Ranking is primarily semantic, with small bounded boosts for:

- same linked anime,
- shared anime genres,
- shared video tags,
- same non-generic category.

The blend deliberately keeps semantic similarity dominant. Metadata cannot overpower a genuinely stronger embedding match.

### UX

The old generic `Up Next` rail now becomes `More like this` when semantic neighbors are available. Each result includes short reasons such as:

- `Same anime`
- `Shared genre: Action, Sci Fi`
- `Very close semantic meaning`

If semantic results are unavailable, the page falls back to the existing trending suggestions rather than leaving the rail empty.

## 2. Semantic Discovery Graph

### New API

- `GET /api/v1/ai/videos/:videoId/graph?limit=10`

### UX

WatchPage now includes a `Map` action beside `More like this`. It opens a visual semantic neighborhood:

- current video in the center,
- related videos around it,
- connection strength based on similarity,
- each node is clickable and opens that video.

This is intentionally described as a semantic discovery graph, not a social graph and not a scene-level graph.

The same graph is also used inside the new Discovery Lab around the strongest collection result.

## 3. Dynamic AI Collections

### New API

- `POST /api/v1/ai/collections`

Request:

```json
{
  "prompt": "dark psychological anime trailers",
  "limit": 18
}
```

This uses the existing local semantic search stack. No paid LLM call is needed to build a collection.

### New page

- `/ai/discover`
- Sidebar label: `Discovery Lab`

Users can create live catalogue collections from prompts such as:

- dark psychological anime trailers
- high-energy shonen promos
- emotional anime videos
- cyberpunk and dystopian anime
- sports anime hype videos
- beautiful fantasy anime trailers

The page shows ranked videos, explains why each belongs, and visualizes the semantic neighborhood around the top result.

## 4. Explainable AI Search

The semantic search response now includes short human-readable `reasons` alongside the existing scores.

Possible reasons include:

- Video title matches your words
- Anime title match
- Character match
- Genre match
- Linked anime metadata matches the description
- Video metadata is semantically close

`AiSearchPage` renders these beneath each result as `Why it matched` chips.

The explanations are derived from retrieval signals already used by AnimeVerse. They do not pretend the system watched YouTube scenes, understood audio, or knows timestamps.

## 5. Stronger Personalized Recommendations

The existing `/api/v1/ai/recommendations` endpoint previously used only recent watch history for the personalized embedding centroid.

It now combines three real user signals:

- recent watch history,
- liked videos,
- Watch Later saves.

Weights intentionally make explicit likes strongest, then recent history, then Watch Later intent.

Recently watched videos are excluded from the fresh recommendation candidate set.

Each recommendation now carries an explanation such as:

- Similar to videos you liked
- Close to your recent watch history
- Matches videos you saved for later

Guest/cold-start recommendations still use the existing popularity + recency fallback and identify that reason honestly.

The recommendation query cache is now user-scoped, and like/Watch Later/history mutations invalidate recommendation data so the Home shelf can adapt instead of serving stale personalization.

## 6. Home and navigation polish

- Home `Recommended for you` cards now show `Why recommended` signals.
- `Scene Search` was renamed to the truthful `AI Search`.
- `Ask` was renamed to `AI Companion`.
- New `Discovery Lab` entry added under the Assistant section.

## 7. Architecture

```text
                         AnimeVerse Discovery Intelligence
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
              Natural-language    Current video     User behavior
                 prompt                │                 │
                    │                 │          history / likes /
                    │                 │           Watch Later
                    ↓                 ↓                 ↓
              MiniLM query      stored embedding   weighted taste
                embedding             │              centroid
                    │                 │                 │
                    └────────────┬────┴────────┬────────┘
                                 ↓             ↓
                           hybrid ranking   recommendations
                                 │
                 ┌───────────────┼────────────────┐
                 ↓               ↓                ↓
             AI Search      Dynamic Collections  Similar Videos
                 │               │                │
                 └───────────────┴───────┬────────┘
                                         ↓
                                explainable reasons
                                         ↓
                                  semantic graph
```

## 8. Safety and data boundaries

This upgrade does **not**:

- download YouTube videos,
- inspect YouTube streams,
- transcribe YouTube audio,
- claim scene/timestamp understanding,
- expose embedding arrays to the frontend,
- introduce a new paid API,
- add a vector database,
- require a database migration.

All discovery endpoints operate only on published AnimeVerse records and compatible stored embeddings.

## 9. Files created

- `backend/src/services/discovery.service.js`
- `backend/src/utils/discoveryExplain.js`
- `backend/tests/discovery.test.mjs`
- `frontend/src/features/discovery/ExplainableVideoCard.jsx`
- `frontend/src/features/discovery/SemanticGraph.jsx`
- `frontend/src/pages/DiscoveryPage.jsx`

## 10. Files modified

- `backend/src/controllers/ai.controller.js`
- `backend/src/routes/ai.routes.js`
- `backend/src/services/semanticSearch.service.js`
- `frontend/src/features/video/hooks.js`
- `frontend/src/layouts/Sidebar.jsx`
- `frontend/src/pages/AiSearchPage.jsx`
- `frontend/src/pages/HomePage.jsx`
- `frontend/src/pages/WatchPage.jsx`
- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/routes/paths.js`
- `frontend/src/services/index.js`

## 11. Verification

Backend full regression suite:

```text
183 tests discovered
176 passed
0 failed
7 skipped
```

The skipped tests are the existing optional/live local-model tests in this Linux sandbox.

New discovery-specific suite:

```text
7 passed
0 failed
```

Additional checks performed:

- all changed backend JavaScript passed `node --check`,
- AI routes imported successfully,
- all changed frontend JSX/JS parsed successfully with Babel,
- every local frontend import in the changed files resolved to an existing file,
- required Lucide icons were verified to exist in the installed version.

A full Vite production build could not be completed in this container because the uploaded `frontend/node_modules` contains Windows Rollup/esbuild native binaries while this execution environment is Linux. The failure occurs before application compilation (`@rollup/rollup-linux-x64-gnu` missing). Run `npm run build` on the original Windows repo.

A read-only live Atlas smoke test was attempted, but this sandbox blocks the MongoDB SRV DNS request (`ECONNREFUSED`). No live database write was attempted.

## 12. Recommended demo flow for an interview

1. Open a video and show that `Up Next` has become semantic `More like this`.
2. Point at the explanation chips and explain the bounded hybrid score.
3. Open `Map` and click through the semantic neighborhood.
4. Open `Discovery Lab` and type `dark cyberpunk anime trailers`.
5. Show the dynamically generated collection and `Why it belongs` reasons.
6. Return Home and show `Why recommended` based on real user activity.
7. Explain that all embeddings run locally with MiniLM while Gemini is used for the conversational agent, keeping retrieval independent of paid LLM calls.
