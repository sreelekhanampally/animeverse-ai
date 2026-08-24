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
    aiChat: "/ai/chat",
    settings: "/settings",
    login: "/login",
    register: "/register",
    forgotPassword: "/forgot-password",
    resetPassword: "/reset-password",
    notFound: "*",
};

/** Channel pages are dynamic, so they're a builder rather than a constant. */
export const channelPath = (username) => `/c/${username}`;
