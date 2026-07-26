import { Router } from "express";
import {
    addComment,
    deleteComment,
    getVideoComments,
    updateComment,
} from "../controllers/comment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Protect all comment routes
router.use(verifyJWT);

// Get all comments for a video
// Add a new comment to a video
router
    .route("/:videoId")
    .get(getVideoComments)
    .post(addComment);

// Update or delete a comment
router
    .route("/c/:commentId")
    .patch(updateComment)
    .delete(deleteComment);

export default router;