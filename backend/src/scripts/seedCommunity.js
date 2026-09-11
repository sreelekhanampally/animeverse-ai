/**
 * Seeds a lively but explicitly demo/test community.
 *
 * This script creates functional AnimeVerse accounts (real User documents with
 * hashed passwords), then uses those accounts for comments, likes and community
 * posts. The personas are intentionally named av_demo_* so seeded engagement is
 * never confused with activity from real people.
 *
 * Plaintext login credentials are written ONLY to:
 *   backend/.seed-output/community-accounts.json
 * The directory is gitignored. Passwords are never committed or printed.
 *
 * Safe to re-run: users are reused, video likes are upserted, known comments and
 * posts are deduplicated, and the credentials file is reused when available.
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { User } from "../models/user.model.js";
import { Video } from "../models/video.model.js";
import { Comment } from "../models/comment.model.js";
import { Like } from "../models/like.model.js";
import { CommunityPost } from "../models/community.model.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(HERE, "../../.seed-output");
const CREDENTIALS_PATH = path.join(OUTPUT_DIR, "community-accounts.json");

const PERSONAS = [
    { username: "av_demo_kage", fullName: "Kage Frames", seed: "KageFrames" },
    { username: "av_demo_mochi", fullName: "Mochi Panels", seed: "MochiPanels" },
    { username: "av_demo_ryu", fullName: "Ryu Rewatch", seed: "RyuRewatch" },
    { username: "av_demo_sora", fullName: "Sora Seasons", seed: "SoraSeasons" },
    { username: "av_demo_nami", fullName: "Nami Notes", seed: "NamiNotes" },
    { username: "av_demo_hoshi", fullName: "Hoshi Queue", seed: "HoshiQueue" },
];

const COMMENTS = [
    "That soundtrack and pacing work so well together.",
    "Adding this one to my rewatch list.",
    "The animation direction here is ridiculously clean.",
    "This is a great entry point for someone new to the series.",
    "The character energy in this clip is excellent.",
    "I forgot how strong this sequence was.",
    "The visual style still holds up beautifully.",
    "This made me want to start the series again.",
    "The music choice really sells the atmosphere.",
    "One of those promos that actually captures the vibe of the anime.",
    "The editing on this is sharp without feeling overdone.",
    "This belongs in a weekend anime marathon.",
];

const POSTS = [
    {
        type: "discussion",
        title: "Which anime has the strongest first three episodes?",
        content: "Pick one series that hooks a new viewer quickly, and say what makes the opening stretch work.",
        tags: ["discussion", "recommendations"],
    },
    {
        type: "poll",
        title: "Weekend watch mood",
        content: "What kind of anime are you most likely to start this weekend?",
        pollOptions: ["Action", "Sports", "Drama", "Comedy"],
        tags: ["poll", "weekend"],
    },
    {
        type: "discussion",
        title: "A sequel that genuinely improved on season one?",
        content: "Not just bigger fights. Which sequel improved its characters, pacing, direction, or world-building?",
        tags: ["discussion", "sequels"],
    },
    {
        type: "news",
        title: "Catalogue check: what should AnimeVerse add next?",
        content: "Drop a series or movie you would like to see represented with official trailers, openings, or promos.",
        tags: ["catalogue", "requests"],
    },
    {
        type: "discussion",
        title: "Best anime soundtrack for studying or coding",
        content: "Share a score or opening that can stay on repeat while you work without stealing all your attention.",
        tags: ["music", "discussion"],
    },
    {
        type: "poll",
        title: "What matters most in a recommendation?",
        content: "If someone asks for one anime recommendation, which signal do you trust first?",
        pollOptions: ["Story", "Characters", "Animation", "Overall vibe"],
        tags: ["poll", "recommendations"],
    },
    {
        type: "discussion",
        title: "Sports anime that works even if you do not follow the sport",
        content: "Which series makes the competition understandable and exciting without requiring prior knowledge?",
        tags: ["sports", "discussion"],
    },
    {
        type: "discussion",
        title: "Anime movie night: one film, one reason",
        content: "Choose a single anime film for a group watch and give the shortest convincing reason you can.",
        tags: ["movies", "discussion"],
    },
    {
        type: "discussion",
        title: "Which rivalries are more interesting than the final battles?",
        content: "Good rivalries change how both characters grow. Which pairing does that best for you?",
        tags: ["characters", "discussion"],
    },
    {
        type: "news",
        title: "AI Search challenge: describe an anime without naming it",
        content: "Try the AI Search with a plot, character, sport, or mood description and share whether it found the right title.",
        tags: ["ai-search", "community"],
    },
    {
        type: "poll",
        title: "Your default episode-count sweet spot",
        content: "When trying a new anime, what length feels easiest to commit to?",
        pollOptions: ["10–13", "20–26", "40–60", "Long-running is fine"],
        tags: ["poll", "watching"],
    },
    {
        type: "discussion",
        title: "A character you understood differently on rewatch",
        content: "What detail changed your interpretation the second time through? Keep spoilers clearly marked.",
        tags: ["rewatch", "characters"],
    },
];

function makePassword() {
    // 24+ chars, mixed alphabet, not derived from username, generated locally.
    return `Av!${crypto.randomBytes(18).toString("base64url")}9z`;
}

async function loadCredentialCache() {
    try {
        const raw = await fs.readFile(CREDENTIALS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return new Map((parsed.accounts || []).map((a) => [a.username, a]));
    } catch {
        return new Map();
    }
}

async function ensureDemoUsers() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const cached = await loadCredentialCache();
    const accounts = [];

    for (let i = 0; i < PERSONAS.length; i += 1) {
        const persona = PERSONAS[i];
        const email = `${persona.username}@animeverse.demo`;
        const avatar = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(persona.seed)}`;
        const existing = await User.findOne({ username: persona.username });
        const remembered = cached.get(persona.username);
        const password = remembered?.password || makePassword();

        let user;
        if (existing) {
            user = existing;
            // If the credentials file vanished, restore a known login for DEMO
            // accounts only. Never changes a non av_demo_* user's password.
            if (!remembered) {
                user.password = password;
                user.fullName = persona.fullName;
                user.avatar = avatar;
                await user.save();
            }
        } else {
            user = await User.create({
                username: persona.username,
                email,
                fullName: persona.fullName,
                avatar,
                password,
            });
        }

        accounts.push({
            username: persona.username,
            email,
            password,
            userId: String(user._id),
            avatar,
        });
    }

    await fs.writeFile(
        CREDENTIALS_PATH,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts }, null, 2)}\n`,
        { mode: 0o600 }
    );

    return accounts;
}

async function samplePublishedVideos(size = 72) {
    return Video.aggregate([
        { $match: { isPublished: true } },
        { $sample: { size } },
        { $project: { _id: 1, title: 1 } },
    ]);
}

async function seedCommentsAndLikes(accounts, videos) {
    if (!videos.length) return { commentsCreated: 0, likesUpserted: 0 };

    let commentsCreated = 0;
    let likesUpserted = 0;

    for (let userIndex = 0; userIndex < accounts.length; userIndex += 1) {
        const account = accounts[userIndex];
        const userId = new mongoose.Types.ObjectId(account.userId);

        // 7 comments per demo account, spread across the sampled catalogue.
        for (let j = 0; j < 7; j += 1) {
            const video = videos[(userIndex * 11 + j * 5) % videos.length];
            const content = COMMENTS[(userIndex * 3 + j) % COMMENTS.length];
            const exists = await Comment.exists({ owner: userId, video: video._id, content });
            if (!exists) {
                await Comment.create({ owner: userId, video: video._id, content });
                commentsCreated += 1;
            }
        }

        // 24 likes per account. Unique index + upsert keeps reruns idempotent.
        for (let j = 0; j < Math.min(24, videos.length); j += 1) {
            const video = videos[(userIndex * 7 + j * 3) % videos.length];
            const result = await Like.updateOne(
                { video: video._id, likedBy: userId },
                { $setOnInsert: { video: video._id, likedBy: userId } },
                { upsert: true }
            );
            if (result.upsertedCount) likesUpserted += 1;
        }
    }

    return { commentsCreated, likesUpserted };
}

async function seedPosts(accounts) {
    let postsCreated = 0;
    let upvotesAdded = 0;

    for (let i = 0; i < POSTS.length; i += 1) {
        const template = POSTS[i];
        const author = accounts[i % accounts.length];
        const authorId = new mongoose.Types.ObjectId(author.userId);
        const existing = await CommunityPost.findOne({ author: authorId, title: template.title });

        let post = existing;
        if (!post) {
            post = await CommunityPost.create({
                type: template.type,
                title: template.title,
                content: template.content,
                tags: template.tags,
                author: authorId,
                pollOptions:
                    template.type === "poll"
                        ? template.pollOptions.map((text) => ({ text, voters: [] }))
                        : [],
            });
            postsCreated += 1;
        }

        // Give each post 2–5 demo upvotes without duplicates.
        const wanted = 2 + (i % 4);
        const voters = accounts
            .filter((a) => a.userId !== author.userId)
            .slice(0, wanted)
            .map((a) => new mongoose.Types.ObjectId(a.userId));
        const before = post.upvotes.length;
        post.upvotes = [...new Map([...post.upvotes, ...voters].map((id) => [String(id), id])).values()];

        if (template.type === "poll" && post.pollOptions.length) {
            for (let k = 0; k < accounts.length; k += 1) {
                const voterId = new mongoose.Types.ObjectId(accounts[k].userId);
                post.pollOptions.forEach((option) => {
                    option.voters = option.voters.filter((id) => !id.equals(voterId));
                });
                post.pollOptions[(k + i) % post.pollOptions.length].voters.push(voterId);
            }
        }

        await post.save();
        upvotesAdded += Math.max(0, post.upvotes.length - before);
    }

    return { postsCreated, upvotesAdded };
}

async function main() {
    await connectDB();
    await Promise.all([User.init(), Like.init(), Video.init()]);

    const publishedCount = await Video.countDocuments({ isPublished: true });
    if (!publishedCount) throw new Error("No published videos exist. Seed/import the catalogue first.");

    const accounts = await ensureDemoUsers();
    const videos = await samplePublishedVideos(Math.min(72, publishedCount));
    const activity = await seedCommentsAndLikes(accounts, videos);
    const community = await seedPosts(accounts);

    console.log("\nAnimeVerse demo-community seed complete");
    console.log(`Demo accounts          : ${accounts.length}`);
    console.log(`Comments created       : ${activity.commentsCreated}`);
    console.log(`New video likes        : ${activity.likesUpserted}`);
    console.log(`Community posts created: ${community.postsCreated}`);
    console.log(`New post upvotes       : ${community.upvotesAdded}`);
    console.log(`Credentials stored at  : ${path.relative(BACKEND_ROOT, CREDENTIALS_PATH)}`);
    console.log("Passwords were intentionally not printed. The output directory is gitignored.");
}

const BACKEND_ROOT = path.resolve(HERE, "../..");

main()
    .catch((error) => {
        console.error(`\nCommunity seed failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
