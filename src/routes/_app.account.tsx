import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Loader2, MonitorSmartphone, RefreshCw, UserCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { wfilemanagerApi, type WFileManagerSession } from "@/lib/wfilemanager-api";
import { formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_app/account")({
  head: () => ({ meta: [{ title: "Account — wFileManager" }] }),
  component: Account,
});

const TIMEZONES = ["UTC", "Africa/Douala", "Africa/Lagos", "Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata"];

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const browser = /Firefox/i.test(userAgent) ? "Firefox" : /Edg/i.test(userAgent) ? "Edge" : /Chrome/i.test(userAgent) ? "Chrome" : /Safari/i.test(userAgent) ? "Safari" : "Browser";
  const system = /Windows/i.test(userAgent) ? "Windows" : /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS" : /Mac OS/i.test(userAgent) ? "macOS" : /Linux/i.test(userAgent) ? "Linux" : "Unknown OS";
  return `${browser} on ${system}`;
}

function Account() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ displayName: "", email: "", timezone: "UTC" });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [sessions, setSessions] = useState<WFileManagerSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async () => {
    setProfileLoading(true);
    setError(null);
    try {
      const result = await wfilemanagerApi.accountProfile();
      setProfile({ displayName: result.user.displayName, email: result.user.email || "", timezone: result.user.timezone || "UTC" });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load account information");
    } finally {
      setProfileLoading(false);
    }
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const result = await wfilemanagerApi.accountSessions();
      setSessions(result.sessions);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to load sessions");
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => { void loadProfile(); void loadSessions(); }, []);

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <UserCircle2 className="h-5 w-5" />
        <div><h1 className="text-xl font-semibold tracking-tight">Account</h1><p className="text-sm text-muted-foreground">Manage your profile, application password and active sessions.</p></div>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Profile</CardTitle><CardDescription>Your identity inside this wFileManager installation.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Display name</Label><Input value={profile.displayName} disabled={profileLoading} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Username</Label><Input value={auth.user?.username || ""} disabled /></div>
            <div className="grid gap-1.5"><Label>Email</Label><Input type="email" value={profile.email} disabled={profileLoading} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Timezone</Label><Select value={profile.timezone} disabled={profileLoading} onValueChange={(timezone) => setProfile({ ...profile, timezone })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((timezone) => <SelectItem key={timezone} value={timezone}>{timezone}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2 flex justify-end">
              <Button disabled={profileSaving || profileLoading || profile.displayName.trim().length < 2} onClick={async () => {
                setProfileSaving(true);
                try {
                  await wfilemanagerApi.updateAccountProfile({ displayName: profile.displayName.trim(), email: profile.email.trim() || null, timezone: profile.timezone });
                  await auth.refresh();
                  toast.success("Profile updated");
                } catch (value) {
                  toast.error(value instanceof Error ? value.message : "Unable to update profile");
                } finally { setProfileSaving(false); }
              }}>{profileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save profile</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Password</CardTitle><CardDescription>This password authenticates only your wFileManager account. It does not create or modify a Linux account.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Current password</Label><Input type="password" autoComplete="current-password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label>New password</Label><Input type="password" autoComplete="new-password" value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Confirm password</Label><Input type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} /></div>
            <div className="sm:col-span-3 flex justify-end">
              <Button disabled={passwordSaving || password.current.length < 1 || password.next.length < 8 || password.next !== password.confirm} onClick={async () => {
                setPasswordSaving(true);
                try {
                  await wfilemanagerApi.changePassword(password.current, password.next);
                  setPassword({ current: "", next: "", confirm: "" });
                  await loadSessions();
                  toast.success("Password changed. Other sessions were revoked.");
                } catch (value) {
                  toast.error(value instanceof Error ? value.message : "Unable to change password");
                } finally { setPasswordSaving(false); }
              }}>{passwordSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Change password</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="h-4 w-4" /> Active sessions</CardTitle><CardDescription>Devices currently authenticated with your account.</CardDescription></div><Button size="icon" variant="outline" onClick={() => void loadSessions()} aria-label="Refresh sessions"><RefreshCw className={`h-4 w-4 ${sessionsLoading ? "animate-spin" : ""}`} /></Button></div></CardHeader>
          <CardContent>
            {sessionsLoading ? <div className="py-8 text-center text-sm text-muted-foreground">Loading sessions…</div> : sessions.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No active sessions.</div> : (
              <ul className="divide-y divide-border">{sessions.map((session) => (
                <li key={session.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{deviceLabel(session.userAgent)}</span>{session.current && <Badge variant="outline">Current</Badge>}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="font-mono">{session.ipAddress || "Unknown IP"}</span><span>Last used {formatRelative(session.lastSeenAt)}</span><span>Expires {formatRelative(session.expiresAt)}</span></div></div>
                  {!session.current && <Button size="sm" variant="outline" onClick={async () => { try { await wfilemanagerApi.revokeSession(session.id); setSessions((items) => items.filter((item) => item.id !== session.id)); toast.success("Session revoked"); } catch (value) { toast.error(value instanceof Error ? value.message : "Unable to revoke session"); } }}>Revoke</Button>}
                </li>
              ))}</ul>
            )}
            <div className="mt-4 flex justify-end"><Button variant="destructive" onClick={async () => { try { await wfilemanagerApi.revokeAllSessions(); wfilemanagerApi.clearToken(); await auth.logout(); navigate({ to: "/login" }); } catch (value) { toast.error(value instanceof Error ? value.message : "Unable to revoke sessions"); } }}>Sign out from all devices</Button></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
