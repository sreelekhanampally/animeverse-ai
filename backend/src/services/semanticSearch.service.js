import { Video } from "../models/video.model.js";
import { Anime } from "../models/anime.model.js";
import {
    cosineSimilarity,
    generateEmbedding,
    isSearchableEmbedding,
} from "./embedding.service.js";
import {
    combineRetrievalScores,
    compareRankedResults,
    lexicalMatchScore,
} from "../utils/semanticRanking.js";

const EMBEDDING_FIELDS =
    "+embedding +embeddingModel +embeddingDimensions +embeddingVersion +embeddingTextHash +embeddingGeneratedAt";

const VIDEO_FIELDS =
    "title description thumbnail views duration owner tags category createdAt sourceType externalVideoId anime isPublished";

const ANIME_FIELDS =
    "title description genres studios characters format status season seasonYear coverImage bannerImage";

const stripEmbedding = (doc) => {
    if (!doc) return doc;
    const copy = { ...doc };
    delete copy.embedding;
    delete copy.embeddingModel;
    delete copy.embeddingDimensions;
    delete copy.embeddingVersion;
    delete copy.embeddingGeneratedAt;
    delete copy.embeddingTextHash;
    return copy;
};

const idOf = (value) => String(value?._id || value || "");

const publicAnime = (anime) => {
    if (!anime) return null;
    const clean = stripEmbedding(anime);
    return {
        _id: clean._id,
        title: clean.title,
        description: clean.description,
        genres: clean.genres,
        studios: clean.studios,
        characters: Array.isArray(clean.characters)
            ? clean.characters.slice(0, 20).map((character) => ({
                  name: character?.name || "",
                  role: character?.role || "",
              }))
            : [],
        format: clean.format,
        status: clean.status,
        season: clean.season,
        seasonYear: clean.seasonYear,
        coverImage: clean.coverImage,
        bannerImage: clean.bannerImage,
    };
};

export async function semanticVideoSearch(query, { limit = 20, maxCandidates = 1500 } = {}) {
    const { embedding: queryEmbedding } = await generateEmbedding(query);

    const [videos, animeDocs] = await Promise.all([
        Video.find({ isPublished: true })
            .select(`${EMBEDDING_FIELDS} ${VIDEO_FIELDS}`)
            .populate("owner", "username fullName avatar verified isVerified")
            .limit(maxCandidates)
            .lean(),
        Anime.find({})
            .select(`${EMBEDDING_FIELDS} ${ANIME_FIELDS}`)
            .limit(500)
            .lean(),
    ]);

    const animeScores = new Map();
    const animeById = new Map();
    let skippedAnime = 0;

    for (const anime of animeDocs) {
        animeById.set(idOf(anime), anime);
        if (!isSearchableEmbedding(anime)) {
            skippedAnime += 1;
            continue;
        }
        const score = cosineSimilarity(queryEmbedding, anime.embedding);
        if (score === null) {
            skippedAnime += 1;
            continue;
        }
        animeScores.set(idOf(anime), score);
    }

    const ranked = [];
    let skippedVideos = 0;

    for (const video of videos) {
        if (!isSearchableEmbedding(video)) {
            skippedVideos += 1;
            continue;
        }

        const videoSemantic = cosineSimilarity(queryEmbedding, video.embedding);
        if (videoSemantic === null) {
            skippedVideos += 1;
            continue;
        }

        const animeId = idOf(video.anime);
        const anime = animeById.get(animeId) || null;
        const animeSemantic = animeScores.get(animeId) ?? 0;
        const lexicalScore = lexicalMatchScore(query, video, anime);
        const score = combineRetrievalScores({
            videoSemantic,
            animeSemantic,
            lexical: lexicalScore,
        });

        const safeVideo = stripEmbedding(video);
        safeVideo.sourceType = safeVideo.sourceType || "cloudinary";
        safeVideo.anime = publicAnime(anime);

        ranked.push({
            video: safeVideo,
            score,
            semanticScore: Number(Math.max(-1, Math.min(1, videoSemantic)).toFixed(6)),
            animeScore: Number(Math.max(-1, Math.min(1, animeSemantic)).toFixed(6)),
            lexicalScore,
            matchType:
                lexicalScore >= 0.45
                    ? "hybrid_title_semantic"
                    : animeSemantic > videoSemantic
                      ? "linked_anime_semantic"
                      : "metadata_semantic",
        });
    }

    ranked.sort(compareRankedResults);

    return {
        results: ranked.slice(0, limit),
        diagnostics: {
            candidateVideos: videos.length,
            candidateAnime: animeDocs.length,
            skippedVideos,
            skippedAnime,
        },
    };
}
