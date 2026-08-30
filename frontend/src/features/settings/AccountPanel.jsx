import { useNavigate } from "react-router-dom";
import { LogOut, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { PATHS } from "@/routes/paths";

/**
 * Read-only account facts plus the two actions that already have backend support.
 *
 * Every row below maps to a real field on the User model. Nothing is invented:
 * there is no plan, billing, phone number or 2FA in this schema, so no such row
 * exists here.
 *
 * Account deletion is intentionally absent — see the note rendered at the bottom.
 * No DELETE /users route exists, and adding one would mean deciding what happens
 * to that user's videos, comments, likes, subscriptions, playlists and Cloudinary
 * assets. That is a separate piece of work, not a checkbox.
 */
function Row({ label, value, mono }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-xs text-muted">{label}</span>
            <span
                className={`min-w-0 truncate text-right text-sm text-white/90 ${
                    mono ? "font-mono text-xs" : ""
                }`}
            >
                {value || "—"}
            </span>
        </div>
    );
}

export function AccountPanel({ onEditProfile }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();

    const handleLogout = async () => {
        await logout();
        toast.info("Signed out");
        navigate(PATHS.home);
    };

    const joined = user?.createdAt
        ? new Date(user.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
          })
        : null;

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Row label="Username" value={user?.username ? `@${user.username}` : null} />
                <Row label="Display name" value={user?.fullName} />
                <Row label="Email" value={user?.email} />
                <Row label="Joined" value={joined} />
            </div>

            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={onEditProfile}>
                    Edit details
                </Button>
                {user?.username && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/c/${user.username}`)}
                    >
                        <ExternalLink className="h-4 w-4" />
                        View channel
                    </Button>
                )}
                <Button size="sm" variant="ghost" onClick={handleLogout}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                </Button>
            </div>

            <p className="border-t border-white/5 pt-3 text-xs text-muted">
                Deleting an account isn't available yet — it needs its own implementation
                to decide what happens to your videos, comments and uploads.
            </p>
        </div>
    );
}
