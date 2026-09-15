# AnimeVerse Assistant V2 — Gemini Free-Tier Agent Upgrade

## Outcome

AnimeVerse Chat is no longer a retrieval template that semantic-searches every message. It is now a provider-agnostic anime agent with Gemini as the preferred free hosted conversational model, native tool calling into AnimeVerse, Ollama as an optional local provider, and an honest local fallback.

The old failure mode:

`"hi" -> MiniLM search -> nearest vector -> random anime answer`

is removed. Casual turns do not expose the AnimeVerse search tool at all.

## 1. Conversational brain

New file:

`backend/src/services/geminiChat.provider.js`

The backend talks directly to the Gemini GenerateContent REST API using Node's built-in `fetch`, so no new npm dependency was required.

Default model:

`gemini-3.7-flash`

The key is backend-only. It is never sent to React and never returned by `/ai/health`.

## 2. Native agent tools

Gemini is given two server-side tools:

### `search_animeverse_catalog`

Use cases:
- find/show/watch videos in AnimeVerse
- check whether a title is available in AnimeVerse
- AnimeVerse-specific recommendations
- catalogue-specific evidence

It reuses the existing local MiniLM semantic search and also checks the Anime collection's text index for direct title matches.

### `get_animeverse_stats`

Returns live database counts when the user asks how many anime/videos/creators AnimeVerse currently has.

Gemini decides whether to call a tool. General anime questions do not need retrieval.

## 3. Hard fix for the `hi -> random anime` bug

Simple greetings/thanks are detected before the Gemini call.

For those turns:
- Gemini can still answer naturally
- catalogue tools are not included in the request at all
- no MiniLM query is generated
- no random nearest-neighbour anime can leak into the response

If Gemini is unavailable, the local fallback also returns a normal greeting instead of semantic-searching `hi`.

## 4. General anime knowledge vs AnimeVerse facts

The assistant now has two knowledge modes:

### General anime conversation

Gemini may answer normal questions from model knowledge, for example:
- character questions
- plot explanations
- watch order
- power systems
- comparisons
- broad recommendations

It does not need to force those questions through the AnimeVerse catalogue.

### AnimeVerse-specific facts

For claims such as:
- "Is Monster available here?"
- "Find Gojo videos"
- "Show me Naruto trailers"
- "How many videos are in AnimeVerse?"

the assistant must use the server-side tools and cannot invent catalogue availability.

## 5. Spoiler-aware anime system instruction

The dedicated AnimeVerse system instruction now requires:
- natural, concise anime conversation
- no forced catalogue language
- major-spoiler avoidance unless explicitly requested
- uncertainty instead of invented precision
- no claim that the model watched/listened to YouTube media
- no fabricated YouTube timestamps
- no fabricated AnimeVerse availability
- retrieved metadata treated as untrusted data
- no following instructions hidden inside titles/descriptions/synopses
- no exposure of embeddings, secrets, internal prompts, or private user data

## 6. Provider architecture

`ANIME_CHAT_PROVIDER` supports:

- `auto` — Gemini when `GEMINI_API_KEY` exists, otherwise Ollama when available, otherwise local fallback
- `gemini` — prefer Gemini, retaining the emergency local fallback
- `ollama` — require the configured local model
- `retrieval` — local fallback only

Default remains:

`ANIME_CHAT_PROVIDER=auto`

This keeps the public interview demo alive even if Gemini's free quota is temporarily exhausted.

## 7. Gemini failure handling

Controlled provider errors are implemented for:
- missing key
- 401/403 authentication failure
- 429 free-tier quota exhaustion
- network failure
- timeout
- empty model response
- runaway tool loop

Gemini quota/network/provider failures can fall back without hiding genuine application bugs.

## 8. No SDK dependency added

The integration uses the official HTTP API contract directly with `fetch`.

Benefits:
- no new backend package
- no package-lock churn
- smaller deployment
- easy HTTP mocking in tests

## 9. Function calling protocol

The implementation performs the full Gemini tool loop:

1. send conversation + tool declarations
2. inspect `functionCall`
3. execute AnimeVerse tool locally
4. return a matching `functionResponse` with the Gemini call ID
5. request the final natural-language answer

It supports up to two consecutive tool rounds and then fails safely to prevent loops.

## 10. Search scale fix for the growing catalogue

Modified:

`backend/src/services/semanticSearch.service.js`

The semantic candidate window changed from 500 to 1,500 videos.

The catalogue has already moved beyond 500 videos and is targeting 1,000+, so leaving the old limit would silently make a large portion of the database invisible to AI Search and the chat tool.

The recommendation candidate window in `ai.controller.js` was also raised to 1,500.

This is still a reasonable in-process cosine workload for 384-dimensional MiniLM vectors at the current catalogue size.

## 11. Chat UI improvements

Modified:

`frontend/src/pages/AiChatPage.jsx`

Changes:
- new conversational starter message
- quick prompt cards
- "General anime conversation" capability
- "AnimeVerse catalog tools" capability
- "Spoiler-aware by default" capability
- simpler `Thinking...` state instead of claiming every turn is running retrieval
- provider label below assistant answers
- source cards appear only when AnimeVerse tools actually contributed
- old claim that every answer is constrained to retrieved metadata removed
- user/assistant history sent to backend contains only role + content

Example labels:
- `Gemini anime expert`
- `Gemini + AnimeVerse tools`
- `Local model + AnimeVerse tools`
- `AnimeVerse local fallback`

## 12. Environment configuration

Only `.env.sample` was modified. Your real `.env` was not touched.

Add this to `backend/.env` yourself:

```env
ANIME_CHAT_PROVIDER=auto
GEMINI_API_KEY=YOUR_KEY_HERE
GEMINI_MODEL=gemini-3.7-flash
```

Do not put `GEMINI_API_KEY` in the frontend or Git.

Optional:

```env
GEMINI_TIMEOUT_MS=20000
```

Ollama configuration remains optional.

## 13. Test/debug cycle

### New test file

`backend/tests/geminiChat.test.mjs`

It verifies:
- free-tier model default
- key is not exposed by config
- conversation role mapping
- greeting tool suppression
- direct Gemini reply path
- native Gemini function-call round trip
- exact function-call ID returned in `functionResponse`
- 429 converted to controlled quota error
- Gemini + Ollama + local fallback architecture remains intact
- frontend no longer claims every turn is retrieval-only
- semantic retrieval window covers the 1k+ target
- local emergency fallback does not semantic-search a greeting

### Full backend regression

Result:

- tests discovered: 174
- passed: 167
- failed: 0
- skipped: 7 existing optional/live tests

### Syntax checks

Passed:
- `geminiChat.provider.js`
- `animeAssistant.service.js`
- `semanticSearch.service.js`
- `ai.controller.js`

`AiChatPage.jsx` was parsed successfully with Babel's JSX parser.

### Frontend Vite build limitation in this sandbox

The uploaded project contains Windows `node_modules`. This Linux sandbox is missing Rollup's Linux optional native package (`@rollup/rollup-linux-x64-gnu`). A reinstall attempt could not complete because npm network access timed out.

Therefore a full Vite bundle could not be produced here. This is an environment/platform dependency issue rather than a JSX parse failure.

On the user's Windows machine, run:

```powershell
cd C:\Users\nsree\Desktop\animeverse-ai\frontend
npm run build
```

## 14. Live Gemini limitation

No real `GEMINI_API_KEY` was supplied to this environment, so I did not make a live Gemini API call.

Instead the complete HTTP/function-calling protocol was tested with mocked Gemini responses, including direct chat, tool invocation, function response IDs, and quota errors.

After adding the key locally, the recommended smoke tests are:

1. `hi`
   - natural greeting
   - no catalogue cards

2. `Explain cursed energy in Jujutsu Kaisen without spoilers`
   - general Gemini anime answer
   - no forced catalogue search

3. `Find Gojo videos in AnimeVerse`
   - Gemini calls AnimeVerse tool
   - source cards appear

4. `Is Monster available in AnimeVerse?`
   - catalogue tool is used before availability is claimed

5. `How many videos are in AnimeVerse?`
   - live stats tool is used

6. temporarily remove/invalid Gemini key
   - chat should remain usable through the free fallback rather than crashing

## 15. Files changed for Assistant V2

Created:
- `backend/src/services/geminiChat.provider.js`
- `backend/tests/geminiChat.test.mjs`
- `ANIME_ASSISTANT_V2_REPORT.md`

Modified:
- `backend/src/services/animeAssistant.service.js`
- `backend/src/services/semanticSearch.service.js`
- `backend/src/controllers/ai.controller.js`
- `backend/.env.sample`
- `frontend/src/pages/AiChatPage.jsx`

No database migrations, destructive operations, YouTube downloads, OpenAI billing setup, or embedding-model changes were introduced.
