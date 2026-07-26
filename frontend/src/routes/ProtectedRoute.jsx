import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PATHS } from "./paths";
import { FullPageLoader } from "@/components/common/FullPageLoader";

export function ProtectedRoute() {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) return <FullPageLoader />;
    if (!user) {
        return <Navigate to={PATHS.login} state={{ from: location.pathname }} replace />;
    }
    return <Outlet />;
}
