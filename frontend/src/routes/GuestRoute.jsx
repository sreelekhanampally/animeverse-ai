import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PATHS } from "./paths";
import { FullPageLoader } from "@/components/common/FullPageLoader";

export function GuestRoute() {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <FullPageLoader />;
    if (user) {
        const to = location.state?.from || PATHS.home;
        return <Navigate to={to} replace />;
    }
    return <Outlet />;
}
