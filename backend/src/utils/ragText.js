import { createHash } from "node:crypto";
import {
    RAG_CHUNK_MAX_CHARS,
    RAG_CHUNK_OVERLAP_CHARS,
    RAG_INDEX_VERSION,
} from "../config/rag.config.js";
import { isTranscriptEligible } from "./embeddingText.js";

const clean = (value) =>
    String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

const unique = (values = []) => {
    const seen = new Set();
    const output = [];
    for (const raw of values) {
        const value = clean(raw);
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        output.push(value);
    }
    return output;
};

export const hashRagText = (text) =>
    createHash("sha256").update(clean(text), "utf8").digest("hex");

export function splitRagText(
    value,
    { maxChars = RAG_CHUNK_MAX_CHARS, overlapChars = RAG_CHUNK_OVERLAP_CHARS } = {}
) {
    const text = clean(value);
    if (!text) return [];
    if (text.length <= maxChars) return [text];

    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let start = 0;

    while (start < words.length) {
        let end = start;
        let length = 0;

        while (end < words.length) {
            const nextLength = length + (length ? 1 : 0) + words[end].length;
            if (nextLength > maxChars && end > start) break;
            length = nextLength;
            end += 1;
        }

        if (end === start) end += 1;
        chunks.push(words.slice(start, end).join(" "));

        if (end >= words.length) break;

        let overlapStart = end;
        let overlapLength = 0;
        while (overlapStart > start) {
            const candidate = words[overlapStart - 1];
            const next = overlapLength + (overlapLength ? 1 : 0) + candidate.length;
            if (next > overlapChars) break;
            overlapLength = next;
            overlapStart -= 1;
        }

        start = overlapStart > start ? overlapStart : end;
    }

    return chunks;
}

const animeTitles = (anime) =>
    unique([
        anime?.title?.display,
        anime?.title?.english,
        anime?.title?.romaji,
        anime?.title?.native,
    ]);

const sourceChunk = ({
    sourceType,
    sourceCollection,
    sourceId,
    sourceTitle,
    section,
    chunkIndex,
    text,
    metadata,
}) => ({
    chunkKey: `${sourceType}:${sourceId}:${section}:${chunkIndex}`,
    sourceType,
    sourceCollection,
    sourceId: String(sourceId),
    sourceTitle: clean(sourceTitle) || "Untitled",
    section,
    chunkIndex,
    text: clean(text),
    metadata: metadata || {},
    indexVersion: RAG_INDEX_VERSION,
    contentHash: hashRagText(text),
    isActive: true,
});

export function buildAnimeRagChunks(anime) {
    if (!anime?._id) return [];

    const titles = animeTitles(anime);
    const title = titles[0] || "Untitled anime";
    const genres = unique(anime.genres).slice(0, 20);
    const studios = unique(anime.studios).slice(0, 10);
    const characters = Array.isArray(anime.characters)
        ? unique(anime.characters.map((item) => item?.name)).slice(0, 12)
        : [];

    const season = [clean(anime.season), anime.seasonYear ? String(anime.seasonYear) : ""]
        .filter(Boolean)
        .join(" ");

    const metadataLines = [
        `Anime: ${title}`,
        titles.length > 1 ? `Also known as: ${titles.slice(1).join(" | ")}` : "",
        anime.format ? `Format: ${anime.format}` : "",
        anime.status ? `Status: ${anime.status}` : "",
        season ? `Season: ${season}` : "",
        genres.length ? `Genres: ${genres.join(", ")}` : "",
        studios.length ? `Studios: ${studios.join(", ")}` : "",
        characters.length ? `Main characters: ${characters.join(", ")}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    const baseMetadata = {
        animeId: String(anime._id),
        animeTitle: title,
        genres,
        format: anime.format || null,
        seasonYear: anime.seasonYear || null,
        metadataSource: anime.metadataSource || "unknown",
    };

    const chunks = [
        sourceChunk({
            sourceType: "anime",
            sourceCollection: "Anime",
            sourceId: anime._id,
            sourceTitle: title,
            section: "identity",
            chunkIndex: 0,
            text: metadataLines,
            metadata: baseMetadata,
        }),
    ];

    splitRagText(anime.description).forEach((text, index) => {
        chunks.push(
            sourceChunk({
                sourceType: "anime",
                sourceCollection: "Anime",
                sourceId: anime._id,
                sourceTitle: title,
                section: "synopsis",
                chunkIndex: index,
                text,
                metadata: baseMetadata,
            })
        );
    });

    return chunks.filter((chunk) => chunk.text);
}

export function buildVideoRagChunks(video, anime = null) {
    if (!video?._id) return [];

    const linkedAnime = anime || (video.anime && video.anime.title ? video.anime : null);
    const linkedTitles = animeTitles(linkedAnime);
    const linkedAnimeTitle = linkedTitles[0] || "";
    const title = clean(video.title) || "Untitled video";
    const tags = unique(video.tags).slice(0, 25);
    const genres = unique(linkedAnime?.genres).slice(0, 12);

    const baseMetadata = {
        videoId: String(video._id),
        videoTitle: title,
        thumbnail: video.thumbnail || "",
        videoSourceType: video.sourceType || "cloudinary",
        animeId: linkedAnime?._id ? String(linkedAnime._id) : null,
        animeTitle: linkedAnimeTitle || null,
        category: video.category || null,
        tags,
        genres,
    };

    const chunks = [];
    const metadataText = [
        `Video: ${title}`,
        linkedAnimeTitle ? `Anime: ${linkedAnimeTitle}` : "",
        video.category ? `Category: ${video.category}` : "",
        tags.length ? `Tags: ${tags.join(", ")}` : "",
        genres.length ? `Anime genres: ${genres.join(", ")}` : "",
        `Source type: ${video.sourceType || "cloudinary"}`,
    ]
        .filter(Boolean)
        .join("\n");

    chunks.push(
        sourceChunk({
            sourceType: "video",
            sourceCollection: "Video",
            sourceId: video._id,
            sourceTitle: title,
            section: "metadata",
            chunkIndex: 0,
            text: metadataText,
            metadata: baseMetadata,
        })
    );

    splitRagText(video.description).forEach((text, index) => {
        chunks.push(
            sourceChunk({
                sourceType: "video",
                sourceCollection: "Video",
                sourceId: video._id,
                sourceTitle: title,
                section: "description",
                chunkIndex: index,
                text,
                metadata: baseMetadata,
            })
        );
    });

    if (isTranscriptEligible(video)) {
        splitRagText(video.transcript).forEach((text, index) => {
            chunks.push(
                sourceChunk({
                    sourceType: "creator_transcript",
                    sourceCollection: "Video",
                    sourceId: video._id,
                    sourceTitle: title,
                    section: "creator_transcript",
                    chunkIndex: index,
                    text,
                    metadata: {
                        ...baseMetadata,
                        transcriptLang: video.transcriptLang || "en",
                    },
                })
            );
        });
    }

    return chunks.filter((chunk) => chunk.text);
}

export const ragTextInternals = { clean, unique, animeTitles };
