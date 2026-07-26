import { Router } from "express";
import { verifyJWT, optionalJWT } from "../middlewares/auth.middleware.js";
import {
    createFanClub,
    listFanClubs,
    joinFanClub,
    leaveFanClub,
    createPost,
    listPosts,
    upvotePost,
    votePoll,
    deletePost,
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
router.post("/posts/:postId/upvote", verifyJWT, upvotePost);
router.post("/posts/:postId/vote", verifyJWT, votePoll);
router.delete("/posts/:postId", verifyJWT, deletePost);

export default router;
