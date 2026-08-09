/**
 * Seed list of popular anime, as AniList ids.
 *
 * Only ids live here — no titles, scores, genres, studios or descriptions. All of
 * that is fetched from AniList at ingestion time, so nothing in this repository
 * can drift from or contradict the upstream source. The `label` on each entry is
 * a comment for humans reading the diff; the ingestion never uses it and never
 * writes it to MongoDB.
 *
 * Every id below was resolved against the live API and confirmed to return the
 * intended series. This matters more than it sounds: AniList ids are not MyAnimeList
 * ids (a plausible-looking id like 31964 is MAL's Boku no Hero and resolves to
 * nothing on AniList), and title search is fuzzy enough that "Demon Slayer"
 * returns an unrelated show called "Onigiri". Verified ids avoid both traps.
 *
 * Sequels and season-splits are deliberately excluded so the catalogue reads as a
 * list of distinct series rather than six Attack on Titan entries.
 */

export const POPULAR_ANIME_SEED = [
    // --- Shonen mainstays (the titles named in the brief) ---
    { anilistId: 20, label: "Naruto" },
    { anilistId: 21, label: "One Piece" },
    { anilistId: 269, label: "Bleach" },
    { anilistId: 223, label: "Dragon Ball" },
    { anilistId: 813, label: "Dragon Ball Z" },
    { anilistId: 16498, label: "Attack on Titan" },
    { anilistId: 101922, label: "Demon Slayer: Kimetsu no Yaiba" },
    { anilistId: 113415, label: "Jujutsu Kaisen" },
    { anilistId: 21459, label: "My Hero Academia" },
    { anilistId: 11061, label: "Hunter x Hunter (2011)" },
    { anilistId: 5114, label: "Fullmetal Alchemist: Brotherhood" },
    { anilistId: 1535, label: "Death Note" },
    { anilistId: 127230, label: "Chainsaw Man" },

    // --- Modern hits ---
    { anilistId: 21087, label: "One-Punch Man" },
    { anilistId: 140960, label: "SPY x FAMILY" },
    { anilistId: 154587, label: "Frieren: Beyond Journey's End" },
    { anilistId: 151807, label: "Solo Leveling" },
    { anilistId: 171018, label: "DAN DA DAN" },
    { anilistId: 120377, label: "Cyberpunk: Edgerunners" },
    { anilistId: 101348, label: "Vinland Saga" },
    { anilistId: 105333, label: "Dr. STONE" },
    { anilistId: 101759, label: "The Promised Neverland" },
    { anilistId: 21827, label: "Violet Evergarden" },
    { anilistId: 132405, label: "My Dress-Up Darling" },

    // --- Established favourites ---
    { anilistId: 1575, label: "Code Geass: Lelouch of the Rebellion" },
    { anilistId: 9253, label: "Steins;Gate" },
    { anilistId: 21355, label: "Re:ZERO -Starting Life in Another World-" },
    { anilistId: 20464, label: "HAIKYU!!" },
    { anilistId: 21507, label: "Mob Psycho 100" },
    { anilistId: 14719, label: "JoJo's Bizarre Adventure (TV)" },
    { anilistId: 20605, label: "Tokyo Ghoul" },
    { anilistId: 20755, label: "Assassination Classroom" },
    { anilistId: 101921, label: "Kaguya-sama: Love is War" },
    { anilistId: 18679, label: "Kill la Kill" },
    { anilistId: 97986, label: "Made in Abyss" },

    // --- Classics ---
    { anilistId: 1, label: "Cowboy Bebop" },
    { anilistId: 30, label: "Neon Genesis Evangelion" },
    { anilistId: 33, label: "Berserk (1997)" },
    { anilistId: 6, label: "Trigun" },
    { anilistId: 205, label: "Samurai Champloo" },
    { anilistId: 392, label: "Yu Yu Hakusho" },
    { anilistId: 2001, label: "Gurren Lagann" },
    { anilistId: 457, label: "Mushi-Shi" },
    { anilistId: 918, label: "Gintama" },

    // --- Films & drama ---
    { anilistId: 199, label: "Spirited Away" },
    { anilistId: 164, label: "Princess Mononoke" },
    { anilistId: 21519, label: "Your Name." },
    { anilistId: 20954, label: "A Silent Voice" },
    { anilistId: 20665, label: "Your Lie in April" },
    { anilistId: 9989, label: "Anohana: The Flower We Saw That Day" },
];

/** Just the ids — the shape the ingestion actually consumes. */
export const POPULAR_ANIME_IDS = POPULAR_ANIME_SEED.map((entry) => entry.anilistId);
