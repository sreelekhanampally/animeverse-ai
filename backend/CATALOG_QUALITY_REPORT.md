# AnimeVerse Catalogue Quality Upgrade

## Goal

This phase changes catalogue growth from "add more rows until the counter reaches 1,000" to "keep a smaller catalogue healthy, searchable, playable, diverse, and worth recommending."

The existing strict YouTube ingestion filter remains the authority. This upgrade adds a repeatable audit/cleanup loop around it and changes future growth to spend quota on coverage gaps first.

## Added

### 1. Read-only catalogue audit

```bash
npm run catalog:audit
```

This performs no YouTube request and no MongoDB write. It checks:

- malformed/missing YouTube ids
- missing Anime links
- missing titles/thumbnails/descriptions
- invalid durations
- stale or missing embeddings
- conservative same-title duplicate groups within one Anime
- Anime with zero YouTube videos
- Anime with fewer than 3 published YouTube videos
- Anime that somehow exceeded the 15-video safety ceiling
- content-type concentration, such as a catalogue row being almost entirely trailers
- Anime metadata completeness grouped by AniList / Jikan / curated source

A detailed machine-readable report is written to:

```text
backend/.reports/catalog-quality-latest.json
```

The folder is gitignored.

### 2. Live YouTube revalidation

```bash
npm run catalog:audit:live
```

This batches the already-stored YouTube ids through the official `videos.list` endpoint, up to 50 ids per request. It does **not** use `search.list`, so it does not spend the scarce search-discovery bucket.

Fresh metadata is re-evaluated through the same availability and quality rules used for new imports. The report separates:

- approved videos
- items that need human review
- high-confidence quarantine candidates
- metadata drift in title, duration, or thumbnail

Nothing is downloaded, scraped, re-hosted, or sent to a transcription service.

### 3. Reversible quarantine

```bash
npm run catalog:quarantine
```

This is intentionally conservative. It only unpublishes high-confidence failures found by a fresh live YouTube check, such as:

- deleted/private/unavailable video
- no longer embeddable
- malformed id
- live/upcoming content
- piracy/full-episode terms
- concept/fan/AI-generated content
- reaction/recap content
- AMV/edit content
- game/crossover promos
- redistribution/aggregator signals
- shorts bait
- live-action adaptation under an anime entry
- invalid duration

It **never deletes a document**. Borderline relevance/score failures stay in the report for manual review rather than being automatically unpublished.

### 4. Quality-first growth

New flag:

```bash
npm run grow:catalog -- --metadata-provider=stored --quality-first
```

Instead of spending YouTube search quota on the most popular Anime first, Anime are ordered by:

1. fewest published YouTube videos
2. highest popularity
3. stable id tie-break

In quality-first mode, each new run starts from coverage offset `0` intentionally. Anime topped up during the previous run fall behind remaining gaps automatically.

### 5. Content-mix aware selection

New imports still pass every existing hard filter and score/rank normally. Before insertion, AnimeVerse now gives different content types a chance to survive the final cut:

- trailers
- teasers
- openings
- endings
- clips/previews
- promos/PVs
- music/theme videos
- other

A soft per-batch content-kind cap prevents a lower-confidence wall of nearly identical trailers from pushing out a useful opening or clip. Exceptionally strong trusted official results can exceed the soft cap, so a legitimate series is not left artificially empty.

### 6. Growth now reports quality, not only count

`growCatalog.js` no longer presents 1,000 as the definition of success. The old count remains only as a secondary reference for backward-compatible CLI behavior.

After a real growth + embedding run it automatically executes an offline quality summary, so operators immediately see whether the catalogue actually improved.

## New npm commands

```bash
npm run catalog:audit
npm run catalog:audit:live
npm run catalog:quarantine
```

Useful options:

```bash
npm run catalog:audit -- --limit=100
npm run catalog:audit -- --summary-only
npm run catalog:audit -- --json=.reports/my-audit.json
npm run catalog:audit -- --no-json
```

## Recommended operating sequence

First inspect the existing database without spending YouTube quota:

```bash
npm run catalog:audit
```

Then perform a live availability/quality verification:

```bash
npm run catalog:audit:live
```

Review `backend/.reports/catalog-quality-latest.json`. If the high-confidence quarantine list looks correct:

```bash
npm run catalog:quarantine
```

If embedding health is below 100%:

```bash
npm run backfill:embeddings -- --target=all
```

When YouTube search quota is available, fill coverage gaps rather than chasing raw count:

```bash
npm run grow:catalog -- --metadata-provider=stored --quality-first
```

For more variety after coverage is healthy, use later query templates deliberately:

```bash
npm run grow:catalog -- --metadata-provider=stored --quality-first --query-offset=2
```

## Safety properties

- audit is read-only by default
- live audit uses the official YouTube Data API only
- live audit uses `videos.list`, not discovery search
- quarantine is reversible (`isPublished=false`), never deletion
- heuristic/borderline failures are not auto-quarantined
- existing 15-video per-Anime ceiling remains enforced
- duplicate detection is scoped per Anime
- no YouTube media is downloaded or re-hosted
- embeddings remain hidden from frontend APIs
- no new API key or dependency was introduced

## Verification

New catalogue-quality tests cover:

- content-kind classification
- mixed-content selection
- trusted-result soft-cap exception
- structural issue detection
- duplicate grouping
- coverage gaps and ceiling violations
- quality-first ordering
- metadata completeness
- conservative quarantine policy

The full backend test suite after this upgrade:

```text
208 tests discovered
201 passed
0 failed
7 skipped
```

The skipped tests are the existing optional/live embedding-provider tests in this execution environment.

A live MongoDB/YouTube audit was not executed from the build sandbox because it does not have reliable access to the user's Atlas/database credentials and external API environment. The new CLI is designed to run against the user's actual backend environment, where it will produce the real catalogue-quality report rather than fabricated quality numbers.
