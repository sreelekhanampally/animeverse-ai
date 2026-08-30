import mongoose, {Schema} from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from 'bcrypt';

const userSchema = new Schema({
        username: {
            type: String,
            required: true,
            unique: true,
            lowercase:true,
            index: true,
            trim:true,
        },
        email : {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim:true,
        },
        fullName : {
            type: String,
            required: true,
            index: true,
            trim:true,
        },
        avatar: {
            type: String,
            required: true
        },

        coverImage: {
            type: String,
            default: ""
        },
        watchHistory: [
            {
                type: Schema.Types.ObjectId,
                ref: "Video"
            }
        ],
        password: {
            type: String,
            required: [true, 'Password is required']
        },
        refreshToken: {
            type:String
        },

        /**
         * Per-user notification switches.
         *
         * Every key here maps to an event the application can actually produce
         * from an existing collection — likes, comments, subscriptions, videos
         * and community posts. There is deliberately no "mentions" key: nothing
         * in the codebase parses @mentions, so a mentions toggle would be a
         * control that silently governs nothing.
         *
         * `default: true` on each field (plus a default for the parent object)
         * means every pre-existing user document keeps behaving exactly as it did
         * before this field existed: reads return all-enabled without a migration
         * and without backfilling a single document.
         */
        notificationPreferences: {
            type: {
                // A channel the user subscribes to published a video.
                uploads: { type: Boolean, default: true },
                // Someone commented on one of the user's videos.
                comments: { type: Boolean, default: true },
                // Someone liked one of the user's videos.
                likes: { type: Boolean, default: true },
                // Someone subscribed to the user's channel.
                subscribers: { type: Boolean, default: true },
                // New post in a fan club the user belongs to.
                community: { type: Boolean, default: true },
            },
            // Nothing addresses a single switch by id, so the automatic
            // subdocument _id would just be a stray ObjectId in every user doc.
            _id: false,
            default: () => ({}),
        },

        /**
         * When the user last opened the notification dropdown. Drives the unread
         * dot in the navbar, which was previously always visible.
         *
         * null means "never opened", so everything counts as unread — the correct
         * reading for existing documents that predate this field.
         */
        notificationsLastReadAt: {
            type: Date,
            default: null,
        }
    }, {timestamps:true}
)
userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;

    this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.isPasswordCorrect = async function(password)  {
    return await bcrypt.compare(password, this.password)
}

userSchema.methods.generateAccessToken = function (){
    return jwt.sign({
        _id: this._id,
        email: this.email,
        fullName: this.fullName,
        username: this.username
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY}
)
}

userSchema.methods.generateRefreshToken = function (){
    return jwt.sign({
        _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY}
)
}

export const User = mongoose.model("User", userSchema);