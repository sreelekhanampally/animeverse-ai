import multer from "multer";
import crypto from "crypto";
import fs from "fs";

const TEMP_DIR = "./public/temp";
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, TEMP_DIR);
    },
    filename: function (req, file, cb) {
        // Prevent collision: <timestamp>-<rand>-<safeOriginal>
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const rand = crypto.randomBytes(6).toString("hex");
        cb(null, `${Date.now()}-${rand}-${safe}`);
    },
});

const allowedMimes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/wav",
    "audio/webm",
]);

const fileFilter = (req, file, cb) => {
    if (!allowedMimes.has(file.mimetype)) {
        return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
};

export const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 200 * 1024 * 1024 },
});
