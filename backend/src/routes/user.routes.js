import { Router } from "express";
import {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
} from "../controllers/user.controller.js";

import { upload } from "../middlewares/multer.middleware.js";
import { verifyJWT, optionalJWT } from "../middlewares/auth.middleware.js";

const router = Router()

router.route("/register").post(
    upload.fields([ {
        name: "avatar",
        maxCount:1
    }, 
    {
        name:"coverImage",
        maxCount:1
    },]), registerUser)

router.route("/login").post(loginUser)

//secured routes
router.route("/logout").post(verifyJWT, logoutUser)
router.route("/refresh-token").post(refreshAccessToken)
router.route("/change-password").post(verifyJWT, changeCurrentPassword)
router.route("/current-user").get(verifyJWT, getCurrentUser)
router.route("/update-account").patch(verifyJWT, updateAccountDetails)
router.route("/update-avatar").patch(verifyJWT, upload.single("avatar"), updateUserAvatar)
router.route("/update-coverImage").patch(verifyJWT, upload.single("coverImage"), updateUserCoverImage)
//when req.params is used
// optionalJWT: channel pages are publicly viewable. When a token is present
// req.user is set so isSubscribed is accurate; guests simply get false.
router.route("/c/:username").get(optionalJWT, getUserChannelProfile)

router.route("/history").get(verifyJWT, getWatchHistory)

export default router;
