# AnimeVerse Assistant V2 Reliability Hotfix

## Why this patch exists

The UI showed a pattern where a greeting could succeed through Gemini while a normal recommendation immediately fell back to the local emergency response. The original V2 implementation exposed AnimeVerse function tools on every non-greeting turn. A normal prompt such as "recommend me an anime" therefore could trigger a tool round and require an extra Gemini request. On a free tier, that unnecessarily increases the chance of per-model throttling or a transient provider failure.

## Changes

1. General anime conversation and recommendations no longer expose AnimeVerse catalogue tools unless the request actually looks catalogue-specific (AnimeVerse, find/search/watch/video/trailer/availability, etc.). This keeps ordinary chat to one Gemini request.
2. Gemini now has free-model failover. Primary remains `gemini-3.7-flash`; default fallbacks are `gemini-3.1-flash-lite` and `gemini-2.5-flash-lite`.
3. Failover is used for quota, timeout, transient request, network, and empty-response failures. Authentication failures stay loud and do not bounce between models.
4. If a Gemini provider error still reaches the local fallback, the backend logs its non-secret error code/message as `[AnimeVerse Gemini] ...` so the cause is visible during debugging.
5. `.env.sample` documents optional `GEMINI_FALLBACK_MODELS` override. No real `.env` or secret is included.

## Verification

- `node --check` passed for both modified backend services and the updated test file.
- Targeted Gemini reliability suite: 7 passed, 0 failed.
- Tests cover direct one-request chat, native function calling, primary-model 429 to Flash-Lite failover, general recommendation tool suppression, quota error handling, and server-side secret/fallback architecture.

## Apply

Extract at the AnimeVerse repo root and replace matching files. Keep your real backend `.env` unchanged. Restart the backend afterward.

Optional explicit fallback configuration:

```env
GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite
```

This variable is optional because the same order is now the code default.
