import { Router } from "express";
import {
    addComment,
    deleteComment,
    getCommentedVideos,
    getVideoComments,
    updateComment,
} from "../controllers/comment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Protect all comment routes
router.use(verifyJWT);

// Videos the current user has commented on — the Library / "Commented videos"
// list. Declared BEFORE "/:videoId" so it can never be shadowed by it. A
// two-segment path would not match the single-segment ":videoId" pattern anyway,
// but this ordering makes that independent of router-matching details.
router.route("/user/videos").get(getCommentedVideos);

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