import { createHash } from "node:crypto";
import { isTranscriptEligible } from "./embeddingText.js";

export const RAG_INDEX_VERSION = "rag-v1";
export const DEFAULT_CHUNK_CHARS = 850;
export const DEFAULT_CHUNK_OVERLAP_CHARS = 120;

const clean = (value) =>
    String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

const uniqueStrings = (values = []) => {
    const seen = new Set();
    const output = [];
    for (const raw of Array.isArray(values) ? values : []) {
        const value = clean(raw);
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        output.push(value);
    }
    return output;
};

export const hashRagContent = (text) =>
    createHash("sha256").update(clean(text), "utf8").digest("hex");

const sentenceSplit = (text) =>
    clean(text)
        .split(/(?<=[.!?。！？])\s+|\n+/u)
        .map(clean)
        .filter(Boolean);

export function chunkText(
    text,
    { maxChars = DEFAULT_CHUNK_CHARS, overlapChars = DEFAULT_CHUNK_OVERLAP_CHARS } = {}
) {
    const normalized = clean(text);
    if (!normalized) return [];
    if (normalized.length <= maxChars) return [normalized];

    const sentences = sentenceSplit(normalized);
    const chunks = [];
    let current = "";

    const pushCurrent = () => {
        const value = clean(current);
        if (value) chunks.push(value);
    };

    for (const sentence of sentences) {
        if (sentence.length > maxChars) {
            if (current) {
                pushCurrent();
                current = "";
            }
            let start = 0;
            while (start < sentence.length) {
                const end = Math.min(sentence.length, start + maxChars);
                chunks.push(clean(sentence.slice(start, end)));
                if (end >= sentence.length) break;
                start = Math.max(end - overlapChars, start + 1);
            }
            continue;
        }

        const proposed = current ? `${current} ${sentence}` : sentence;
        if (proposed.length <= maxChars) {
            current = proposed;
            continue;
        }

        const previous = clean(current);
        pushCurrent();
        const overlap = previous.slice(Math.max(0, previous.length - overlapChars)).trim();
        current = clean(overlap ? `${overlap} ${sentence}` : sentence);
    }

    if (current) pushCurrent();

    return chunks.filter(Boolean);
}

const animeTitle = (anime) =>
    anime?.title?.display || anime?.title?.english || anime?.title?.romaji || anime?.title?.native || "Unknown anime";

const animeAliases = (anime) =>
    uniqueStrings([
        anime?.title?.display,
        anime?.title?.english,
        anime?.title?.romaji,
        anime?.title?.native,
    ]);

const animeMetadataBlock = (anime) => {
    const aliases = animeAliases(anime);
    const genres = uniqueStrings(anime?.genres);
    const studios = uniqueStrings(anime?.studios);
    const characters = Array.isArray(anime?.characters)
        ? uniqueStrings(anime.characters.map((item) => item?.name)).slice(0, 12)
        : [];

    return [
        `Anime: ${animeTitle(anime)}`,
        aliases.length > 1 ? `Also known as: ${aliases.slice(1).join(" | ")}` : "",
        anime?.format ? `Format: ${anime.format}` : "",
        anime?.status ? `Status: ${anime.status}` : "",
        anime?.season || anime?.seasonYear
            ? `Season: ${[anime?.season, anime?.seasonYear].filter(Boolean).join(" ")}`
            : "",
        genres.length ? `Genres: ${genres.join(", ")}` : "",
        studios.length ? `Studios: ${studios.join(", ")}` : "",
        characters.length ? `Characters: ${characters.join(", ")}` : "",
    ]
        .filter(Boolean)
        .join("\n");
};

const toChunkRecord = ({
    sourceType,
    sourceId,
    anime = null,
    video = null,
    title,
    content,
    chunkIndex,
    chunkCount,
    metadata = {},
}) => ({
    sourceType,
    sourceId,
    anime,
    video,
    title: clean(title),
    content: clean(content),
    chunkIndex,
    chunkCount,
    metadata,
    contentHash: hashRagContent(content),
    indexVersion: RAG_INDEX_VERSION,
});

export function buildAnimeRagChunks(anime) {
    if (!anime?._id) return [];

    const title = animeTitle(anime);
    const metadata = {
        genres: uniqueStrings(anime.genres).slice(0, 20),
        animeMetadataSource: clean(anime.metadataSource),
    };
    const records = [];

    const identity = animeMetadataBlock(anime);
    records.push(
        toChunkRecord({
            sourceType: "anime_metadata",
            sourceId: anime._id,
            anime: anime._id,
            title,
            content: identity,
            chunkIndex: 0,
            chunkCount: 1,
            metadata,
        })
    );

    const synopsisChunks = chunkText(anime.description, { maxChars: 850, overlapChars: 120 });
    synopsisChunks.forEach((synopsis, index) => {
        records.push(
            toChunkRecord({
                sourceType: "anime_synopsis",
                sourceId: anime._id,
                anime: anime._id,
                title: `${title} synopsis`,
                content: `Anime: ${title}\nSynopsis: ${synopsis}`,
                chunkIndex: index,
                chunkCount: synopsisChunks.length,
                metadata,
            })
        );
    });

    return records;
}

export function buildVideoRagChunks(video, anime = null) {
    if (!video?._id || video.isPublished === false) return [];

    const linkedAnime = anime || (video?.anime && video.anime?.title ? video.anime : null);
    const animeName = linkedAnime ? animeTitle(linkedAnime) : "";
    const genres = uniqueStrings(linkedAnime?.genres).slice(0, 20);
    const metadata = {
        genres,
        category: clean(video.category),
        videoSourceType: clean(video.sourceType || "cloudinary"),
        animeMetadataSource: clean(linkedAnime?.metadataSource),
        transcriptLang: clean(video.transcriptLang),
    };

    const tags = uniqueStrings(video.tags).slice(0, 25);
    const metadataContent = [
        `Video: ${clean(video.title)}`,
        animeName ? `Anime: ${animeName}` : "",
        video.category ? `Category: ${clean(video.category)}` : "",
        tags.length ? `Tags: ${tags.join(", ")}` : "",
        genres.length ? `Genres: ${genres.join(", ")}` : "",
        video.description ? `Description: ${clean(video.description).slice(0, 2500)}` : "",
        `Source: ${video.sourceType || "cloudinary"}`,
    ]
        .filter(Boolean)
        .join("\n");

    const records = [
        toChunkRecord({
            sourceType: "video_metadata",
            sourceId: video._id,
            anime: linkedAnime?._id || video.anime || null,
            video: video._id,
            title: clean(video.title) || "Untitled video",
            content: metadataContent,
            chunkIndex: 0,
            chunkCount: 1,
            metadata,
        }),
    ];

    if (isTranscriptEligible(video)) {
        const transcriptChunks = chunkText(video.transcript, {
            maxChars: 850,
            overlapChars: 140,
        });
        transcriptChunks.forEach((transcript, index) => {
            records.push(
                toChunkRecord({
                    sourceType: "creator_transcript",
                    sourceId: video._id,
                    anime: linkedAnime?._id || video.anime || null,
                    video: video._id,
                    title: `${clean(video.title) || "Untitled video"} transcript`,
                    content: [
                        `Video: ${clean(video.title)}`,
                        animeName ? `Anime: ${animeName}` : "",
                        `Transcript excerpt: ${transcript}`,
                    ]
                        .filter(Boolean)
                        .join("\n"),
                    chunkIndex: index,
                    chunkCount: transcriptChunks.length,
                    metadata,
                })
            );
        });
    }

    return records;
}

export const ragChunkingInternals = {
    clean,
    uniqueStrings,
    sentenceSplit,
    animeMetadataBlock,
};
