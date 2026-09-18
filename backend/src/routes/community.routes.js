import { Router } from "express";
import { verifyJWT, optionalJWT } from "../middlewares/auth.middleware.js";
import {
    createFanClub,
    listFanClubs,
    joinFanClub,
    leaveFanClub,
    createPost,
    listPosts,
    getPost,
    upvotePost,
    votePoll,
    deletePost,
    listPostComments,
    addPostComment,
    deletePostComment,
} from "../controllers/community.controller.js";

const router = Router();

// Fan clubs
router.get("/clubs", optionalJWT, listFanClubs);
router.post("/clubs", verifyJWT, createFanClub);
router.post("/clubs/:clubId/join", verifyJWT, joinFanClub);
router.post("/clubs/:clubId/leave", verifyJWT, leaveFanClub);

// Posts
router.get("/posts", optionalJWT, listPosts);
router.post("/posts", verifyJWT, createPost);
router.get("/posts/:postId", optionalJWT, getPost);
router.post("/posts/:postId/upvote", verifyJWT, upvotePost);
router.post("/posts/:postId/vote", verifyJWT, votePoll);
router.delete("/posts/:postId", verifyJWT, deletePost);

// Discussion threads
router.get("/posts/:postId/comments", optionalJWT, listPostComments);
router.post("/posts/:postId/comments", verifyJWT, addPostComment);
router.delete("/posts/:postId/comments/:commentId", verifyJWT, deletePostComment);

export default router;
