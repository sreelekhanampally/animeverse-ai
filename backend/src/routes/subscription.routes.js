import { Router } from "express";
import {
    getSubscribedChannels,
    getSubscribedChannelVideos,
    getUserChannelSubscribers,
    toggleSubscription,
} from "../controllers/subscription.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

// /feed -> videos from every channel the current user subscribes to.
// Declared before the parameterised routes so it can never be captured by one.
router.route("/feed").get(getSubscribedChannelVideos);

// /c/:channelId -> list subscribers of this channel; POST toggles subscription
router
    .route("/c/:channelId")
    .get(getUserChannelSubscribers)
    .post(toggleSubscription);

// /u/:subscriberId -> list channels a user has subscribed to
router.route("/u/:subscriberId").get(getSubscribedChannels);

export default router;
