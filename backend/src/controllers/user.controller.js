import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { cookieOptions } from "../utils/cookieOptions.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessTokenAndRefreshToken = async(userId) => {
    try {
        const user = await User.findById(userId)
        if (!user) {
    throw new ApiError(404, "User not found");
}
        const refreshToken = user.generateRefreshToken()
        const accessToken = user.generateAccessToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false})

        return {accessToken, refreshToken}

    } catch (error) {
    console.error("Generate Token Error:", error);
    throw new ApiError(
        500,
        error.message || "Something went wrong while generating refresh and access token"
    );
}
}

const registerUser = asyncHandler(async (req, res) => {
    // Get user details from request body
    const { fullName, email, username, password } = req.body;

    // Validate required fields
    if (
        [fullName, email, username, password].some(
            (field) => field?.trim() === ""
        )
    ) {
        throw new ApiError(400, "All fields are required");
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        throw new ApiError(400, "Invalid email address");
    }

    // Validate username
    if (username.trim().length < 3) {
        throw new ApiError(
            400,
            "Username must be at least 3 characters long"
        );
    }

    // Validate password
    if (password.length < 8) {
        throw new ApiError(
            400,
            "Password must be at least 8 characters long"
        );
    }

    // Normalize input
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();

    // Check if username already exists
    const existingUsername = await User.findOne({
        username: normalizedUsername,
    });

    if (existingUsername) {
        throw new ApiError(409, "Username is already taken");
    }

    // Check if email already exists
    const existingEmail = await User.findOne({
        email: normalizedEmail,
    });

    if (existingEmail) {
        throw new ApiError(409, "Email is already registered");
    }
    // console.log("req multer file path : " , req.files)
    // Check avatar & cover image
    const avatarLocalPath = req.files?.avatar?.[0]?.path;
    const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }

    //  Upload Images to Cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if (!avatar) { 
        throw new ApiError(500,
        "Failed to upload avatar"
    );
}

    // Create the User
    const user = await User.create({
    fullName: fullName.trim(),
    email: normalizedEmail,
    username: normalizedUsername,
    password,
    avatar: avatar.secure_url,
    coverImage: coverImage?.secure_url || "", });

    //Check if user was created & Remove sensitive fields

    if (!user) {
    throw new ApiError( 500,
        "Something went wrong while registering the user"
    );}

    const createdUser = await User.findById(user._id).select("-password -refreshToken");

    if (!createdUser) { 
        throw new ApiError( 500,
        "Failed to fetch created user"
    );}

    return res.status(201).json(
        new ApiResponse(201, createdUser, "User Created Successfully")
    )
 
});

const loginUser = asyncHandler(async (req, res) => {
    // Get user credentials
    const { email, username, password } = req.body;

    // Validate input
    if (!(username || email)) {
        throw new ApiError(400, "Username or email is required");
    }

    // Find user
    const user = await User.findOne({
        $or: [{ username }, { email }]
    });

    if (!user) {
        throw new ApiError(404, "User does not exist");
    }

    // Check password
    const isPasswordValid = await user.isPasswordCorrect(password);

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials");
    }

    // Generate tokens
    const { accessToken, refreshToken } =
        await generateAccessTokenAndRefreshToken(user._id);

    // Get user without sensitive fields
    const loggedInUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );

    // Cookie options
    const options = cookieOptions;

    // Send response
    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken,
                },
                "User logged in successfully"
            )
        );
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            returnDocument: "after"
        }
    );

    const options = cookieOptions;

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(
            new ApiResponse(200, {}, "User logged out successfully")
        );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken =
        req.cookies?.refreshToken ||
        req.body?.refreshToken ||
        req.header("x-refresh-token");

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request");
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        const user = await User.findById(decodedToken?._id);

        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== user.refreshToken) {
            throw new ApiError(
                401,
                "Refresh token is expired or has already been used"
            );
        }

        const { accessToken, refreshToken } =
            await generateAccessTokenAndRefreshToken(user._id);

        const options = {
            httpOnly: true,
            secure: true,
        };

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    {
                        accessToken,
                        refreshToken,
                    },
                    "Access token refreshed successfully"
                )
            );
    } catch (error) {
        throw new ApiError(
            401,
            error?.message || "Invalid refresh token"
        );
    }
});

const changeCurrentPassword = asyncHandler(async (req,res) => {
    const { oldPassword, newPassword, confPassword} = req.body
    if (!(newPassword === confPassword)) {
        throw new ApiError(400, "New password and confirm password do not match")
    }
    if (!oldPassword || !newPassword) {
        throw new ApiError(400, "Old password and new password are required");
    }
    if (oldPassword === newPassword) {
        throw new ApiError(400, "New password must be different from old password");
    }

    const user = await User.findById(req.user?._id)
    if (!user) {
        throw new ApiError(404, "User not found");
    }
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)
    
    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    /**
     * Rotate the session after a password change.
     *
     * Changing a password has to invalidate the credentials that were issued
     * under the old one — otherwise a stolen refresh token keeps working
     * indefinitely and "change my password" gives a false sense of security.
     *
     * This reuses the existing generateAccessTokenAndRefreshToken helper, which
     * overwrites user.refreshToken. Because refreshAccessToken compares the
     * incoming token against that stored value, every previously-issued refresh
     * token stops working at this point. No new session mechanism is introduced.
     *
     * The caller who changed the password is kept logged in by handing back fresh
     * tokens (and cookies) in the same response, so the UI does not have to bounce
     * the user to the login screen.
     */
    const { accessToken, refreshToken } =
        await generateAccessTokenAndRefreshToken(user._id)

    const options = cookieOptions;

    return res.status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json( new ApiResponse( 200, { accessToken, refreshToken }, "Password changed successfully"))
});

const getCurrentUser = asyncHandler(async(req,res) => {
    return res.status(200)
    .json(
        new ApiResponse(200, req.user,
             "current user fetched successfully "
            )
        )
})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullName, email, username } = req.body;

    if (!fullName?.trim() || !email?.trim()) {
        throw new ApiError(400, "Full name and email are required");
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Ensure email isn't already taken by someone else
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing && existing._id.toString() !== req.user._id.toString()) {
        throw new ApiError(409, "Email is already in use");
    }

    const update = { fullName: fullName.trim(), email: normalizedEmail };

    /**
     * `username` is optional so every existing caller that sends only
     * fullName + email keeps working byte-for-byte. It is only validated and
     * written when the client actually supplies it.
     *
     * The rules mirror registerUser (>= 3 chars, lowercased) rather than
     * inventing a second standard, plus the same character set the frontend
     * registerSchema already enforces — otherwise a username could be created at
     * registration that could never be re-saved here, or vice versa.
     */
    if (username !== undefined) {
        const normalizedUsername = String(username).trim().toLowerCase();

        if (normalizedUsername.length < 3) {
            throw new ApiError(400, "Username must be at least 3 characters long");
        }
        if (normalizedUsername.length > 24) {
            throw new ApiError(400, "Username must be at most 24 characters long");
        }
        if (!/^[a-z0-9_.-]+$/.test(normalizedUsername)) {
            throw new ApiError(
                400,
                "Username may only contain letters, numbers, dot, dash and underscore"
            );
        }

        /**
         * Checked explicitly so the client gets a 409 with a readable message.
         * The unique index on `username` is still the real guarantee — two
         * concurrent requests can both pass this read, and the index is what
         * stops the second one from writing (handled below).
         */
        const usernameOwner = await User.findOne({ username: normalizedUsername });
        if (usernameOwner && usernameOwner._id.toString() !== req.user._id.toString()) {
            throw new ApiError(409, "Username is already taken");
        }

        update.username = normalizedUsername;
    }

    let user;
    try {
        user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: update },
            { new: true, runValidators: true }
        ).select("-password -refreshToken");
    } catch (error) {
        // E11000 = duplicate key. Reachable when a concurrent request claimed the
        // same username or email between the check above and this write.
        if (error?.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || "value";
            throw new ApiError(409, `That ${field} is already taken`);
        }
        throw error;
    }

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    // Get current user
    const currentUser = await User.findById(req.user?._id);

    if (!currentUser) {
        throw new ApiError(404, "User not found");
    }
    const oldAvatar = currentUser.avatar;
    // Upload new avatar
    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar || !avatar.secure_url) {
        throw new ApiError(500, "Failed to upload avatar");
    }

    // Update avatar details
    currentUser.avatar = avatar.secure_url;

    await currentUser.save({ validateBeforeSave: false });

    // Delete old avatar from Cloudinary (if it exists)
    if (oldAvatar) {
    const publicId = getPublicIdFromUrl(oldAvatar);
    await deleteFromCloudinary(publicId);
    }

    // Fetch updated user without sensitive fields
    const user = await User.findById(currentUser._id).select(
        "-password -refreshToken"
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "Avatar updated successfully"
        )
    );
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Cover image file is required");
    }

    // Get current user
    const currentUser = await User.findById(req.user?._id);

    if (!currentUser) {
        throw new ApiError(404, "User not found");
    }

    // Save old cover image URL
    const oldCoverImage = currentUser.coverImage;

    // Upload new cover image
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage || !coverImage.secure_url) {
        throw new ApiError(500, "Failed to upload cover image");
    }

    // Update cover image
    currentUser.coverImage = coverImage.secure_url;

    await currentUser.save({ validateBeforeSave: false });

    // Delete old cover image from Cloudinary
    if (oldCoverImage) {
        const publicId = getPublicIdFromUrl(oldCoverImage);
        await deleteFromCloudinary(publicId);
    }

    // Fetch updated user
    const user = await User.findById(currentUser._id).select(
        "-password -refreshToken"
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "Cover image updated successfully"
        )
    );
});

const getUserChannelProfile = asyncHandler(async (req,res) => {
        const {username} = req.params
        if (!username?.trim()) {
            throw new ApiError(400, "username is missing")
        }
        const channel = await User.aggregate([ 
            {
                $match: {
                    username: username?.toLowerCase()
                }
            },
            {
                $lookup:{
                    from:"subscriptions",
                    localField: "_id",
                    foreignField: "channel",
                    as: "subscribers"
                }
            },
            {
                $lookup:{
                    from:"subscriptions",
                    localField: "_id",
                    foreignField: "subscriber",
                    as: "subscribedTo"
                }
            },
            {
                $addFields:{
                    subscribersCount:{
                       $size: "$subscribers" 
                    },
                    channelsSubscribedToCount: {
                       $size: "$subscribedTo" 
                    },
                    isSubscribed: {
                        $cond: {
                            if: { $in: [req.user?._id, "$subscribers.subscriber"]},
                            then: true,
                            else: false
                        }

                    }
                }
            },
            {
                $project: {
                    fullName:1,
                    username: 1,
                    subscribersCount:1,
                    channelsSubscribedToCount:1,
                    avatar:1,
                    coverImage:1,
                    // isSubscribed was already computed above but never projected,
                    // so the client could not show the correct subscribe state.
                    isSubscribed:1,
                    // Real join date for the channel's About tab.
                    createdAt:1,
                }
            }
        ])

        if (!channel?.length){
            throw new ApiError(404, "Channel does not exist")
        }

        return res.status(200)
        .json(
            new ApiResponse(200, channel[0], "User channel fetched successfully")
        )
    
    
});

const getWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {   // <-- addFields (plural)
                            owner: {
                                $first: "$owner"
                            },
                            // Watch history renders the same video cards, so it gets
                            // the same source normalisation for legacy documents.
                            sourceType: { $ifNull: ["$sourceType", "cloudinary"] },
                            externalVideoId: { $ifNull: ["$externalVideoId", ""] }
                        }
                    },
                    {
                        $project: {
                            __v: 0,
                            embedding: 0
                        }
                    }
                ]
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            user[0].watchHistory,
            "Watch history fetched successfully"
        )
    );
});



/**
 * The switches a client is allowed to set, and therefore the single place this
 * list is defined on the backend. Anything else in the request body is ignored
 * rather than merged, so a client cannot write arbitrary keys into the user
 * document through this endpoint.
 */
const NOTIFICATION_PREFERENCE_KEYS = [
    "uploads",
    "comments",
    "likes",
    "subscribers",
    "community",
];

/**
 * Fills in any key the stored document is missing.
 *
 * Users created before `notificationPreferences` existed have no such field, and
 * a user who was updated when the list was shorter can be missing newer keys.
 * Defaulting to `true` on read matches the schema default, so the API always
 * returns the complete set and the UI never has to render an undefined toggle.
 */
const withPreferenceDefaults = (stored) => {
    const source = stored || {};
    return NOTIFICATION_PREFERENCE_KEYS.reduce((acc, key) => {
        acc[key] = source[key] === undefined ? true : Boolean(source[key]);
        return acc;
    }, {});
};

const getNotificationPreferences = asyncHandler(async (req, res) => {
    // req.user is set by verifyJWT from the signed token. The id is never read
    // from the body, params or query, so one user cannot read another's settings.
    const user = await User.findById(req.user._id).select("notificationPreferences");

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            withPreferenceDefaults(user.notificationPreferences),
            "Notification preferences fetched successfully"
        )
    );
});

const updateNotificationPreferences = asyncHandler(async (req, res) => {
    const body = req.body || {};

    /**
     * A partial update: only the keys actually present in the request are
     * written. That lets the UI send a single toggle without having to restate
     * the others, and means an older client cannot wipe a preference it does not
     * know about.
     *
     * Values must be real booleans. Accepting "false" (a non-empty string, which
     * is truthy) would silently turn a switch ON when the user turned it off.
     */
    const update = {};
    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
        if (body[key] === undefined) continue;
        if (typeof body[key] !== "boolean") {
            throw new ApiError(400, `Preference "${key}" must be true or false`);
        }
        update[`notificationPreferences.${key}`] = body[key];
    }

    if (!Object.keys(update).length) {
        throw new ApiError(
            400,
            `At least one preference is required (${NOTIFICATION_PREFERENCE_KEYS.join(", ")})`
        );
    }

    // Dot-path $set updates only the named sub-fields, leaving the rest of the
    // user document — including password and refreshToken — untouched.
    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: update },
        { new: true }
    ).select("notificationPreferences");

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            withPreferenceDefaults(user.notificationPreferences),
            "Notification preferences updated successfully"
        )
    );
});

/**
 * Marks the notification feed as seen — the navbar's unread dot reads this.
 * Separate from the preferences endpoints because it records an event ("opened
 * the tray now") rather than changing a setting.
 */
const markNotificationsRead = asyncHandler(async (req, res) => {
    const readAt = new Date();

    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: { notificationsLastReadAt: readAt } },
        { new: true }
    ).select("notificationsLastReadAt");

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            { notificationsLastReadAt: user.notificationsLastReadAt },
            "Notifications marked as read"
        )
    );
});

export { registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory,
    getNotificationPreferences,
    updateNotificationPreferences,
    markNotificationsRead,
    NOTIFICATION_PREFERENCE_KEYS
};