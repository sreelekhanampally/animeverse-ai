import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

const extractToken = (req) => {
    return (
        req.cookies?.accessToken ||
        req.header("Authorization")?.replace("Bearer ", "").trim() ||
        null
    );
};

export const verifyJWT = asyncHandler(async (req, _, next) => {
    try {
        const token = extractToken(req);
        if (!token) throw new ApiError(401, "Unauthorized request");

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");
        if (!user) throw new ApiError(401, "Invalid Access Token");

        req.user = user;
        next();
    } catch (error) {
        next(new ApiError(401, error?.message || "Invalid access token"));
    }
});

// Optional auth — sets req.user if a valid token is present, otherwise continues anonymously.
export const optionalJWT = asyncHandler(async (req, _, next) => {
    try {
        const token = extractToken(req);
        if (!token) return next();
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        const user = await User.findById(decoded?._id).select("-password -refreshToken");
        if (user) req.user = user;
    } catch {
        // ignore for optional auth
    }
    next();
});
