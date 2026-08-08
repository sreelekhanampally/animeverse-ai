import { Router } from 'express';
import {
    deleteVideo,
    getAllVideos,
    getVideoById,
    publishAVideo,
    togglePublishStatus,
    updateVideo,
} from "../controllers/video.controller.js"
import {verifyJWT, optionalJWT} from "../middlewares/auth.middleware.js"
import {upload} from "../middlewares/multer.middleware.js"

const router = Router();

// Auth is applied per route, not to the whole router. Public discovery (GET)
// uses optionalJWT so guests can browse while logged-in users still get their
// personalised fields (isLiked, watch history). Every mutation keeps verifyJWT.

router
    .route("/")
    .get(optionalJWT, getAllVideos)          // PUBLIC — published videos only
    .post(
        verifyJWT,                            // PROTECTED — upload
        upload.fields([
            {
                name: "videoFile",
                maxCount: 1,
            },
            {
                name: "thumbnail",
                maxCount: 1,
            },

        ]),
        publishAVideo
    );

router
    .route("/:videoId")
    .get(optionalJWT, getVideoById)                                  // PUBLIC — watch page
    .delete(verifyJWT, deleteVideo)                                  // PROTECTED
    .patch(verifyJWT, upload.single("thumbnail"), updateVideo);      // PROTECTED

router.route("/toggle/publish/:videoId").patch(verifyJWT, togglePublishStatus); // PROTECTED

export default router