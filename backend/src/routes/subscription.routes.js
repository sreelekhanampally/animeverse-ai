import { Router } from "express";
import {
    getSubscribedChannels,
    getUserChannelSubscribers,
    toggleSubscription,
} from "../controllers/subscription.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

// /c/:channelId -> list subscribers of this channel; POST toggles subscription
router
    .route("/c/:channelId")
    .get(getUserChannelSubscribers)
    .post(toggleSubscription);

// /u/:subscriberId -> list channels a user has subscribed to
router.route("/u/:subscriberId").get(getSubscribedChannels);

export default router;
