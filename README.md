# AnimeVerse AI 

Verified state at handoff. Everything below was checked against the running code,
the real YouTube Data API v3 and the live MongoDB database, not inferred from notes.

## Verified state

- Backend: Node/Express/Mongoose, ESM. Frontend: React 19 + Vite 5, builds clean.
- YouTube ingestion is complete and internal-CLI only (`npm run ingest:youtube`).
  There is no HTTP ingestion route.
- Tests: `cd backend && node --test tests/` → **67/67 pass**. Node's built-in
  `node:test` only; no test dependency was added.
- Database (`youtube`): 50 anime, 65 videos = 61 YouTube + 2 cloudinary + 2 legacy
  (legacy = no `sourceType` field; they read back as `cloudinary` via the schema default).
- All 61 stored YouTube IDs re-checked against the real API: 61/61 exist, are public,
  embeddable, processed and not live. 60/61 linked to an Anime; the unlinked one is
  the Phase 1 test fixture. Cost: 2 quota units (2 × `videos.list`, no `search.list`).
- Re-scoring the 61 stored videos through the current filter: **52 pass, 9 rejected**
  (2 live-action adaptations, 2 denylisted-after-review, 1 redistribution, 1 fabricated
  concept trailer, 1 Hollywood casting, 1 game crossover, 1 untrusted-no-promo).
  51 unique title fingerprints — 1 group of 2 is the Death Note Netflix cross-post.
- No duplicate `externalVideoId`. The partial unique index exists in the live DB:
  `sourceType_1_externalVideoId_1 UNIQUE partial {sourceType:"youtube", externalVideoId:{$type:"string"}}`.

## Non-negotiable architecture rules (still holding)

- Creator upload → Cloudinary → HTML5 `<video>` (`sourceType:"cloudinary"`, `videoFile`).
- AniList metadata → YouTube Data API v3 → `youtube-nocookie.com` embed
  (`sourceType:"youtube"`, `externalVideoId`, `videoFile` empty).
- Never: YouTube → download → re-host. Static scan of `backend/src` finds **0** matches for
  `youtube.com/watch`, `googlevideo`, `ytdl`, `yt-dlp`, `youtube-dl`, `streamingData`,
  `playerResponse`, `get_video_info`. The only YouTube host in the codebase is
  `https://www.googleapis.com/youtube/v3`.
- `channelTitle` is deliberately **not** persisted on the Video schema.

## Outstanding decision (no action taken)

10 reviewed records are still in the database. Nothing has been deleted or modified.
9 have zero references anywhere; 1 (`YE7VzlLtp-4`, the Phase 1 fixture) is referenced
once, at index 5 of 9, in real user `sree_1510`'s watchHistory. The database already
contains 131 pre-existing dangling video references, so the app tolerates them — that
is context, not permission. The canonical Death Note record `gvxNaSIB_WI` must be kept.

## Next phase (proposed, NOT implemented)

An AI layer already exists: `backend/src/services/ai.service.js`,
`backend/src/controllers/ai.controller.js`, `backend/src/routes/ai.routes.js`, with
`openai` already in `dependencies`. It is wired but unfed:

- `OPENAI_API_KEY` is absent, so `embedText` returns a 32-dim hash pseudo-vector while
  `text-embedding-3-small` is 1536-dim, and `cosineSim` returns 0 on length mismatch.
  Only 4 videos carry embeddings, all 32-dim stubs, all Cloudinary/legacy.
- `transcribeAudio(localFilePath)` needs a **local file**. YouTube media is never
  downloaded and must not be, so Whisper is applicable to Cloudinary uploads only.
- `GET /api/v1/ai/search` loads up to 500 documents and scores them in process — fine
  at 65 documents, not a vector-DB substitute.
- `frontend/src/services/index.js` calls `POST /ai/chat`, which does not exist (404).

So the honest next phase is **text-based enrichment**: embed
`title + description + AniList metadata` for all 65 videos, backfill in one script,
add a dimension guard so stub and real vectors can never be mixed, then wire the two
placeholder AI pages. Whisper stays scoped to Cloudinary uploads.
