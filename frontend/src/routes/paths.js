export const PATHS = {
    home: "/",
    trending: "/trending",
    community: "/community",
    subscriptions: "/subscriptions",
    playlists: "/playlists",
    history: "/history",
    liked: "/liked",
    // Videos the signed-in user has commented on.
    library: "/library",
    watchLater: "/watch-later",
    upload: "/upload",
    dashboard: "/dashboard",
    aiSearch: "/ai/search",
    aiDiscover: "/ai/discover",
    aiEvaluation: "/ai/evaluation",
    aiChat: "/ai/chat",
    settings: "/settings",
    login: "/login",
    register: "/register",
    forgotPassword: "/forgot-password",
    resetPassword: "/reset-password",
    notFound: "*",
};

/** Dynamic routes use builders so callers do not hand-build URLs. */
export const communityPostPath = (postId) => `/community/${postId}`;
export const channelPath = (username) => `/c/${username}`;
