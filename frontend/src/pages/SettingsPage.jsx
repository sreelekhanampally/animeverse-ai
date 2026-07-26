import { Settings as SettingsIcon, User, Shield, Bell } from "lucide-react";
import { SectionHeader } from "@/features/home/SectionHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
    const { user } = useAuth();
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
                    <Button size="sm" variant="ghost" disabled>Edit</Button>
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
                    <p className="text-sm text-muted">
                        Update your public profile, username, and channel details.
                    </p>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-4 w-4" /> Security
                        </CardTitle>
                    </CardHeader>
                    <p className="text-sm text-muted">
                        Change your password and manage active sessions.
                    </p>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Bell className="h-4 w-4" /> Notifications
                        </CardTitle>
                    </CardHeader>
                    <p className="text-sm text-muted">
                        Choose what pings you — uploads, replies, mentions.
                    </p>
                </Card>
            </div>
        </div>
    );
}
