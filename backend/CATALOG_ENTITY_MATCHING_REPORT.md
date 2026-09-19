# AnimeVerse Catalogue Entity-Matching Upgrade

## Why this patch exists

The catalogue-quality audit exposed a real entity-resolution failure: a YouTube search for **D.Gray-man** could return Netflix videos for **The Gray Man**. The uploader was legitimate, but the content was unrelated to the linked Anime document.

This patch makes anime identity a separate gate from source trust.

## What changed

### 1. Strict Anime ↔ video entity gate

New imports must now strongly identify the target Anime before they can be stored. The matcher uses:

- `title.display`, `title.english`, `title.romaji`, and `title.native`
- punctuation-normalized full-title aliases
- native-script aliases
- safe subtitle/base-title aliases such as `Naruto: Shippuden -> Naruto`
- a small reviewed abbreviation table such as `AOT`, `FMAB`, `MHA`, and `JJK`
- meaningful short identity tokens such as the `D` in `D.Gray-man` and numeric titles such as `86`

Partial word overlap is no longer enough to establish an Anime association.

### 2. Trusted channels no longer bypass relevance

A trusted channel proves that the uploader is legitimate. It does **not** prove that a video is about the Anime being ingested.

Example now rejected:

`D.Gray-man <- THE GRAY MAN | Official Trailer | Netflix`

The series' own official channel remains the only safe exception when an individual video title omits the series name.

### 3. Reviewed collision rules

Known repeatable collisions can be classified with high confidence. The initial rules cover:

- `D.Gray-man` vs `The Gray Man`
- `Monster` vs unrelated Monster products/titles
- `Orange` vs `Orange Is the New Black`

These rules are scoped to one Anime identity. They are not global keyword bans.

### 4. Existing catalogue association audit

The normal catalogue audit now also reports:

- Anime/video links that need review
- known high-confidence entity collisions

The offline pass never unpublishes anything because it cannot verify the uploader/channel context.

### 5. Focused repair command

Dry run:

```powershell
npm run catalog:associations
```

This uses YouTube `videos.list`, re-checks the current title/channel metadata, and writes:

```text
.reports/catalog-association-repair-latest.json
```

It separates findings into:

- strong/current links
- manual-review mismatches
- safe high-confidence collisions

Apply only the reviewed collision candidates:

```powershell
npm run catalog:associations:apply
```

Apply mode is reversible. It only sets `isPublished=false`; it never deletes rows. Generic entity mismatches remain manual-review only.

### 6. Regression coverage

Added tests for:

- D.Gray-man must not accept The Gray Man even from Netflix
- D.Gray-man punctuation variants
- native-script title matching
- reviewed abbreviations such as AOT
- overlapping title words such as Black Clover vs Black Butler
- Death Note anime vs trusted live-action trailers
- conservative quarantine policy

## Verification

Full backend suite after the patch:

```text
213 tests discovered
206 passed
0 failed
7 skipped
```

The skipped tests are the existing optional/live local-model checks in this environment.

## Recommended run order

```powershell
cd C:\Users\nsree\Desktop\animeverse-ai\backend

npm test
npm run catalog:audit
npm run catalog:associations
```

Review `.reports/catalog-association-repair-latest.json` before applying anything.

If the collision list looks correct:

```powershell
npm run catalog:associations:apply
npm run catalog:audit
```

Do not resume broad catalogue growth until the false-association pass is clean enough for your quality bar.
