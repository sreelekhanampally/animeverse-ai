import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { PATHS } from "./paths";
import { ProtectedRoute } from "./ProtectedRoute";
import { GuestRoute } from "./GuestRoute";
import { MainLayout } from "@/layouts/MainLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import { FullPageLoader } from "@/components/common/FullPageLoader";

const HomePage = lazy(() => import("@/pages/HomePage.jsx"));
const TrendingPage = lazy(() => import("@/pages/TrendingPage.jsx"));
const CommunityPage = lazy(() => import("@/pages/CommunityPage.jsx"));
const SubscriptionsPage = lazy(() => import("@/pages/SubscriptionsPage.jsx"));
const PlaylistsPage = lazy(() => import("@/pages/PlaylistsPage.jsx"));
const PlaylistDetailPage = lazy(() => import("@/pages/PlaylistDetailPage.jsx"));
const HistoryPage = lazy(() => import("@/pages/HistoryPage.jsx"));
const LikedPage = lazy(() => import("@/pages/LikedPage.jsx"));
const WatchLaterPage = lazy(() => import("@/pages/WatchLaterPage.jsx"));
const WatchPage = lazy(() => import("@/pages/WatchPage.jsx"));
const UploadVideoPage = lazy(() => import("@/pages/UploadVideoPage.jsx"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage.jsx"));
const AiSearchPage = lazy(() => import("@/pages/AiSearchPage.jsx"));
const AiChatPage = lazy(() => import("@/pages/AiChatPage.jsx"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage.jsx"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage.jsx"));

const LoginPage = lazy(() => import("@/pages/auth/LoginPage.jsx"));
const RegisterPage = lazy(() => import("@/pages/auth/RegisterPage.jsx"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/ForgotPasswordPage.jsx"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/ResetPasswordPage.jsx"));

export function AppRoutes() {
    return (
        <Suspense fallback={<FullPageLoader />}>
            <Routes>
                {/* Public app shell (browsing allowed while logged out) */}
                <Route element={<MainLayout />}>
                    <Route path={PATHS.home} element={<HomePage />} />
                    <Route path={PATHS.trending} element={<TrendingPage />} />
                    <Route path={PATHS.community} element={<CommunityPage />} />
                    <Route path="/watch/:videoId" element={<WatchPage />} />

                    {/* Protected sections */}
                    <Route element={<ProtectedRoute />}>
                        <Route path={PATHS.subscriptions} element={<SubscriptionsPage />} />
                        <Route path={PATHS.playlists} element={<PlaylistsPage />} />
                        <Route path="/playlists/:playlistId" element={<PlaylistDetailPage />} />
                        <Route path={PATHS.history} element={<HistoryPage />} />
                        <Route path={PATHS.liked} element={<LikedPage />} />
                        <Route path={PATHS.watchLater} element={<WatchLaterPage />} />
                        <Route path={PATHS.upload} element={<UploadVideoPage />} />
                        <Route path={PATHS.dashboard} element={<DashboardPage />} />
                        <Route path={PATHS.aiSearch} element={<AiSearchPage />} />
                        <Route path={PATHS.aiChat} element={<AiChatPage />} />
                        <Route path={PATHS.settings} element={<SettingsPage />} />
                    </Route>
                </Route>

                {/* Auth pages (guest only) */}
                <Route element={<GuestRoute />}>
                    <Route element={<AuthLayout />}>
                        <Route path={PATHS.login} element={<LoginPage />} />
                        <Route path={PATHS.register} element={<RegisterPage />} />
                        <Route path={PATHS.forgotPassword} element={<ForgotPasswordPage />} />
                        <Route path={PATHS.resetPassword} element={<ResetPasswordPage />} />
                    </Route>
                </Route>

                <Route path="/404" element={<NotFoundPage />} />
                <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
        </Suspense>
    );
}