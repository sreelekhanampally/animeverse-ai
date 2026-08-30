import { useState } from "react";
import { Settings as SettingsIcon, User, Shield, Bell } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { EditProfileModal } from "@/features/settings/EditProfileModal";
import { ChangePasswordModal } from "@/features/settings/ChangePasswordModal";
import { AccountPanel } from "@/features/settings/AccountPanel";
import { NotificationPreferences } from "@/features/settings/NotificationPreferences";

export default function SettingsPage() {
    const { user } = useAuth();
    const [editOpen, setEditOpen] = useState(false);
    const [passwordOpen, setPasswordOpen] = useState(false);

    return (
        <div className="space-y-6">
            <SectionHeader
                icon={SettingsIcon}
                title="Settings"
                subtitle="Preferences, security, and notifications."
            />

            <Card>
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    {/* Enabled only when the user has actually loaded — clicking Edit
                        before that would open a form with nothing to pre-fill. */}
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={!user}
                        onClick={() => setEditOpen(true)}
                    >
                        Edit
                    </Button>
                </CardHeader>
                <div className="flex items-center gap-4">
                    <Avatar size="xl" src={user?.avatar} name={user?.fullName || user?.username} />
                    <div>
                        <div className="font-display text-lg font-semibold text-white">
                            {user?.fullName || user?.username || "Anonymous"}
                        </div>
                        <div className="text-sm text-muted">@{user?.username || "guest"}</div>
                        <div className="text-xs text-muted">{user?.email}</div>
                    </div>
                </div>
            </Card>

            <div className="grid gap-6 md:grid-cols-3">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-4 w-4" /> Account
                        </CardTitle>
                    </CardHeader>
                    <AccountPanel onEditProfile={() => setEditOpen(true)} />
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-4 w-4" /> Security
                        </CardTitle>
                    </CardHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-muted">
                            Change your password. Signing in again elsewhere will be required.
                        </p>
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={!user}
                            onClick={() => setPasswordOpen(true)}
                        >
                            Change password
                        </Button>
                        {/* Stated rather than shown as a dead control: there is no
                            session-listing endpoint, so a "manage sessions" UI would
                            have nothing real behind it. */}
                        <p className="border-t border-white/5 pt-3 text-xs text-muted">
                            Changing your password signs out every other session. Listing
                            individual active sessions isn't supported yet.
                        </p>
                    </div>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Bell className="h-4 w-4" /> Notifications
                        </CardTitle>
                    </CardHeader>
                    <NotificationPreferences />
                </Card>
            </div>

            <EditProfileModal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                user={user}
            />
            <ChangePasswordModal
                open={passwordOpen}
                onClose={() => setPasswordOpen(false)}
            />
        </div>
    );
}
