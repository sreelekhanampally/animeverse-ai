# AnimeVerse Catalogue Association Matcher Refinement

## Why this patch exists

The live association audit found 206 records in the manual-review bucket. Several were false positives caused by catalogue naming differences rather than bad videos, including `Hunter x Hunter (2011)` versus official YouTube titles that simply say `Hunter X Hunter`. The same report also exposed real false associations such as Tokyo Ghoul receiving Netflix's unrelated `Ghoul` trailer and The Promised Neverland receiving unrelated Neverland films.

This patch tightens those two sides separately: legitimate naming variation is accepted more accurately, while known title collisions remain safe-to-quarantine.

## Changes

### 1. Release-year and format qualifiers are not treated as core identity

A catalogue title such as:

- `Hunter x Hunter (2011)`

now derives the safe base alias:

- `Hunter x Hunter`

The matcher also strips a terminal catalogue year and terminal `(TV)` / `(TV Series)` / `(Anime Series)` metadata when building aliases. It does not rewrite the persisted Anime document.

### 2. Reviewed aliases are applied to derived base titles

The reviewed alias table is now looked up using safe derived aliases as well as raw provider titles. This means `Hunter x Hunter (2011)` can inherit `HxH` without duplicating year-specific entries.

Observed/reviewed variants added:

- `Full Alchemist Brotherhood` / `FMA Brotherhood` for Fullmetal Alchemist: Brotherhood
- `Toyko Ghoul`, `Tokyo Guru`, and `東京喰種` for Tokyo Ghoul

### 3. Conservative typo tolerance

For multi-token anime identities only, one longer title token may contain one edit or one adjacent transposition. This handles human/provider mistakes such as `Toyko Ghoul` while refusing to fuzzy-match short generic words.

The fuzzy path requires:

- at least two significant identity tokens
- only one fuzzy token
- the fuzzy token to be at least four characters
- complete identity coverage

It therefore cannot make generic tokens such as `one`, `no`, or `x` sufficient evidence.

### 4. New high-confidence collision rules

Tokyo Ghoul now rejects an unrelated title beginning with `Ghoul` when it is presented as a trailer.

The Promised Neverland now recognises these as different works:

- Finding Neverland
- Peter Pan's Neverland
- Neverland Nightmare

These are marked as high-confidence entity collisions, so the existing association repair tool may safely quarantine them after a dry run.

### 5. Regression coverage from the real audit

Added tests for:

- Hunter x Hunter (2011) vs official Hunter X Hunter openings/trailers
- Tokyo Ghoul native-script anniversary MV
- `Toyko Ghoul` typo
- Tokyo Ghoul vs Netflix `Ghoul`
- The Promised Neverland vs Finding Neverland
- The Promised Neverland vs Peter Pan's Neverland Nightmare
- `Full Alchemist: Brotherhood` shorthand

The existing D.Gray-man vs The Gray Man and Death Note live-action tests remain intact.

## Verification

The reconstructed current AnimeVerse backend test suite completed with:

- 218 tests discovered
- 211 passed
- 0 failed
- 7 skipped (existing optional/live-model tests)

The focused YouTube/entity suite completed with:

- 77 passed
- 0 failed

## Next command

Apply this patch at the repository root, then run:

```powershell
cd C:\Users\nsree\Desktop\animeverse-ai\backend
npm test
npm run catalog:associations
```

The second command is still a dry run. Compare the new `Needs human review` count with the previous 206. Do not run `catalog:associations:apply` until the new collision list has been inspected.
