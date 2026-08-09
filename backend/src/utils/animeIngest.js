/**
 * Anime ingestion.
 *
 * Turns AniList payloads into Anime documents. Kept separate from both the
 * AniList client (which only fetches) and the CLI script (which only handles
 * argv and printing) so the ingestion logic can be called from a job or an
 * authenticated admin route later without dragging either along.
 *
 * Idempotency is the whole point of this module: running it twice must produce
 * the same collection, never duplicates.
 */

import { Anime } from "../models/anime.model.js";
import {
    fetchAnimeByIds,
    fetchPopularAnime,
    mapAniListMediaToAnime,
    searchAnime,
} from "../services/anilist.service.js";
import { POPULAR_ANIME_IDS } from "../seeds/popularAnime.js";

/**
 * Upserts one AniList payload.
 *
 * `findOneAndUpdate` with `upsert: true` on the unique `anilistId` is used rather
 * than a read-then-write: the unique index makes the operation atomic, so two
 * concurrent runs cannot both pass an existence check and then both insert. The
 * `upsertedCount`/`rawResult` tells us which of the two happened, which is what
 * the imported-vs-updated report needs.
 *
 * `runValidators` is on because schema validation (enums, required display title)
 * does not run on updates by default — without it a malformed upstream payload
 * would silently bypass the model's guarantees.
 */
export async function upsertAnimeFromMedia(media) {
    const doc = mapAniListMediaToAnime(media);

    const result = await Anime.findOneAndUpdate(
        { anilistId: doc.anilistId },
        { $set: doc },
        {
            upsert: true,
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true,
            includeResultMetadata: true,
        }
    );

    // Mongoose 8 exposes the driver's raw result here. `upserted` is only present
    // when a new document was actually created.
    const created = Boolean(result?.lastErrorObject?.upserted);

    return {
        created,
        updated: !created,
        anime: result?.value || null,
        anilistId: doc.anilistId,
        title: doc.title.display,
    };
}

/**
 * Ingests a list of AniList media payloads one at a time.
 *
 * Sequential and individually guarded on purpose: the brief requires that one
 * bad record does not abort the run (anime 3 fails, anime 4 still succeeds). A
 * bulk write would either abort early or make per-item error reporting opaque,
 * and these are cheap local writes — the network cost was already paid by the
 * batched fetch.
 */
async function ingestMediaList(mediaList, { onProgress } = {}) {
    const report = {
        requested: mediaList.length,
        imported: 0,
        updated: 0,
        failed: 0,
        failures: [],
        items: [],
    };

    for (const media of mediaList) {
        const id = media?.id ?? "unknown";
        try {
            const outcome = await upsertAnimeFromMedia(media);
            if (outcome.created) report.imported += 1;
            else report.updated += 1;

            report.items.push({
                anilistId: outcome.anilistId,
                title: outcome.title,
                action: outcome.created ? "imported" : "updated",
            });
            onProgress?.({
                status: "success",
                action: outcome.created ? "imported" : "updated",
                anilistId: outcome.anilistId,
                title: outcome.title,
            });
        } catch (error) {
            report.failed += 1;
            report.failures.push({ anilistId: id, reason: error.message });
            onProgress?.({ status: "failed", anilistId: id, reason: error.message });
            // Deliberately swallowed: the loop must continue to the next anime.
        }
    }

    return report;
}

/**
 * Import by explicit AniList ids.
 *
 * Ids that AniList does not know are silently omitted from its response, so they
 * are reconciled here and reported as failures instead of vanishing — otherwise a
 * typo'd id would look like a successful run of fewer anime.
 */
export async function ingestAnimeByIds(anilistIds, { onProgress } = {}) {
    const requestedIds = [...new Set((anilistIds || []).map(Number).filter(Number.isFinite))];
    if (!requestedIds.length) {
        return { requested: 0, imported: 0, updated: 0, failed: 0, failures: [], items: [] };
    }

    const media = await fetchAnimeByIds(requestedIds);

    const report = await ingestMediaList(media, { onProgress });
    // Re-base `requested` on what was asked for, not on what came back.
    report.requested = requestedIds.length;

    const returnedIds = new Set(media.map((m) => m.id));
    for (const id of requestedIds) {
        if (!returnedIds.has(id)) {
            report.failed += 1;
            report.failures.push({ anilistId: id, reason: "Not found on AniList" });
            onProgress?.({ status: "failed", anilistId: id, reason: "Not found on AniList" });
        }
    }

    return report;
}

/**
 * Import by search term.
 *
 * AniList's fuzzy matching can return something unrelated for a near-miss, so
 * this takes the top `limit` results and ingests them rather than assuming the
 * first hit is correct. The caller sees exactly what was stored in the report.
 */
export async function ingestAnimeBySearch(query, { limit = 5, onProgress } = {}) {
    const media = await searchAnime(query, { limit });
    if (!media.length) {
        return {
            requested: 0,
            imported: 0,
            updated: 0,
            failed: 0,
            failures: [],
            items: [],
            note: `No AniList results for "${query}"`,
        };
    }
    return ingestMediaList(media, { onProgress });
}

/** Import the curated seed list of popular anime (ids verified against AniList). */
export async function ingestPopularSeed({ limit, onProgress } = {}) {
    const ids = Number.isFinite(limit) && limit > 0
        ? POPULAR_ANIME_IDS.slice(0, limit)
        : POPULAR_ANIME_IDS;
    return ingestAnimeByIds(ids, { onProgress });
}

/**
 * Import straight from AniList's live popularity ranking. Useful for discovering
 * ids that are not in the static seed list without hardcoding anything.
 */
export async function ingestTrendingFromAniList({ limit = 50, onProgress } = {}) {
    const collected = [];
    let page = 1;

    while (collected.length < limit) {
        const { media, hasNextPage } = await fetchPopularAnime({ page });
        collected.push(...media);
        if (!hasNextPage) break;
        page += 1;
    }

    return ingestMediaList(collected.slice(0, limit), { onProgress });
}
