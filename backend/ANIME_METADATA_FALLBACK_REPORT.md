# AnimeVerse Metadata Fallback + 1K Catalogue Upgrade

## Why this pass was needed

The live catalogue had reached 675 published videos with 50 Anime documents, and every Video/Anime embedding was current. The next bottleneck was no longer embeddings or YouTube filtering: AniList's public GraphQL API was temporarily disabled, so the metadata catalogue could not expand beyond those 50 Anime documents.

This pass makes metadata growth resilient instead of making AniList a single point of failure.

## 1. Metadata provider chain

`grow:catalog` now uses this default strategy:

```text
AniList
  ↓ if unavailable
Jikan / MyAnimeList
  ↓ if unavailable
existing MongoDB Anime documents
```

The normal command remains:

```powershell
npm run grow:catalog -- --offset=0
```

No new API key is required for Jikan.

Optional explicit modes are available:

```powershell
npm run grow:catalog -- --metadata-provider=jikan --offset=0
npm run grow:catalog -- --metadata-provider=stored --offset=0
npm run grow:catalog -- --metadata-provider=anilist --offset=0
```

The old `--skip-anilist` flag remains supported and maps to stored-metadata mode.

## 2. Jikan client

New file:

`backend/src/services/jikan.service.js`

It fetches only a small SFW popularity-ranked catalogue from:

`GET https://api.jikan.moe/v4/top/anime?filter=bypopularity&sfw=true`

Properties:

- no API key
- 25 rows per page
- conservative ~1.1 second request spacing
- bounded retry/backoff for 429/5xx responses
- timeout handling
- dedupe by MAL id
- does not crawl episodes/reviews/staff/relations

A 160-anime target needs only about seven Jikan metadata requests.

## 3. Mapping Jikan into the existing Anime model

Jikan data is normalized into the AnimeVerse schema:

- MAL title / English / Japanese title
- synopsis
- genres
- studios
- cover art
- episode count
- runtime
- season/year
- format
- source
- status
- score normalized to AnimeVerse's 0-100 convention
- popularity represented by MAL member count so higher remains more popular
- trailer YouTube id where available
- source URL
- `metadataSource: "jikan"`

Unknown values remain `null`, `""`, or `[]`; the mapper does not fabricate facts.

## 4. Identity without a database-index migration

The existing Anime model requires a unique `anilistId`. Jikan does not provide AniList ids.

Instead of altering the live MongoDB unique index, Jikan-only rows receive a deterministic negative surrogate:

```text
MAL 5114 -> anilistId -5114
```

Real AniList ids are positive, so the namespaces cannot collide.

The real MAL id is always stored in `malId`.

When AniList recovers, AniList ingestion now matches by either real `anilistId` or `malId`. A Jikan fallback row is therefore promoted in-place from the negative surrogate to the real AniList id rather than duplicated.

## 5. AniList data remains preferred

Jikan ingestion checks for an existing AniList-backed row with the same MAL id.

If one exists, it is preserved rather than overwritten. This matters because existing AniList records can contain richer character/banner metadata that the Jikan top-anime response does not contain.

So Jikan expands the catalogue without downgrading the original 50 Anime documents.

## 6. Jikan-specific YouTube growth batches

A second problem existed after metadata expansion: the normal YouTube batch sorted across every Anime document. A 40-anime batch could therefore be wasted on older Anime records that already had 15/15 videos.

`ingestYouTube.js` now accepts:

```text
--metadata-source=jikan
```

When the automatic fallback used Jikan successfully, `growCatalog.js` automatically sends that filter. The first new growth batch therefore targets the newly added Jikan Anime records directly.

This keeps the offset sequence stable within the fallback catalogue:

```powershell
npm run grow:catalog -- --offset=0
npm run grow:catalog -- --offset=40
npm run grow:catalog -- --offset=80
```

## 7. YouTube quota reporting corrected for the 2026 quota change

The old source still printed the pre-June-2026 model:

```text
search.list = 100 units
```

That is no longer the current YouTube quota model.

The code now reports search and ordinary quota separately:

```text
search.list : N calls from the dedicated search bucket
videos.list : N calls / regular quota units
```

This makes the CLI match YouTube's current granular quota system rather than displaying the obsolete `78 × 100` estimate.

## 8. New operator command

`backend/package.json` now includes:

```powershell
npm run ingest:jikan -- --popular --limit=160
```

A fetch-only check is also available:

```powershell
npm run ingest:jikan -- --popular --limit=20 --dry-run
```

The ordinary `grow:catalog` command already invokes it automatically after an AniList failure, so manual use is optional.

## 9. Embeddings remain unchanged

Nothing in the embedding architecture changed.

New Anime and Video records still flow through:

```text
all-MiniLM-L6-v2
384 dimensions
metadata-v2
local inference
```

`grow:catalog` still runs `backfillEmbeddings.js --target=all` after YouTube ingestion, so every newly imported document becomes searchable by AI Search and usable by Anime Chat.

## 10. YouTube safety rules remain unchanged

This pass does not weaken the existing video gate and does not add any media extraction.

Still prohibited/not implemented:

- YouTube downloads
- yt-dlp / youtube-dl
- stream extraction
- googlevideo URLs
- re-hosting YouTube video on Cloudinary
- Whisper on YouTube media
- fake/fan trailer acceptance
- reaction/AMV/shorts spam acceptance

The current strict filtering logic remains the gatekeeper.

## 11. Tests

New test file:

`backend/tests/jikanFallback.test.mjs`

It verifies:

- Jikan by-popularity + SFW request construction
- no Jikan API key is added
- deterministic negative fallback ids
- schema mapping
- null preservation
- duration parsing
- AniList recovery by MAL id
- fallback chain
- Jikan-only YouTube targeting
- 2026 YouTube quota reporting

Final backend run in the supplied repository:

```text
158 tests
151 passed
0 failed
7 skipped
```

The seven skips are the existing optional/live tests; no test failed.

All changed backend JavaScript files also passed `node --check`.

## 12. What to run after applying the patch

From:

`C:\Users\nsree\Desktop\animeverse-ai\backend`

First:

```powershell
npm test
```

Then test the Jikan fallback itself without writing:

```powershell
npm run ingest:jikan -- --popular --limit=20 --dry-run
```

If that succeeds, run the real catalogue flow:

```powershell
npm run grow:catalog -- --offset=0
```

Expected high-level sequence while AniList is down:

```text
AniList refresh fails
→ Jikan top-popularity import succeeds
→ existing AniList rows preserved
→ new Jikan Anime rows created
→ YouTube batch targets metadataSource=jikan
→ strict YouTube filtering/import
→ local MiniLM backfill
→ updated catalogue status
```

Because YouTube search now has its own default daily search-call bucket, do not blindly launch multiple 80-search batches on the same day. Let the CLI finish and inspect its `search.list` call count before starting the next offset.

## Files in this patch

- `backend/.env.sample`
- `backend/package.json`
- `backend/src/models/anime.model.js`
- `backend/src/scripts/growCatalog.js`
- `backend/src/scripts/ingestAnime.js`
- `backend/src/scripts/ingestJikan.js`
- `backend/src/scripts/ingestYouTube.js`
- `backend/src/services/jikan.service.js`
- `backend/src/services/youtube.service.js`
- `backend/src/utils/animeIngest.js`
- `backend/src/utils/youtubeIngest.js`
- `backend/tests/jikanFallback.test.mjs`

No `.env`, API key, password, model cache, database dump, or user credential is included in the patch.
