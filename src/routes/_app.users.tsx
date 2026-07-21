import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { wfilemanagerApi, type AuthUser, type WFileManagerRole } from "@/lib/wfilemanager-api";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";
import { localApi } from "@/lib/local-api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "Users — wFileManager" }] }),
  component: Users,
});

function Users() {
  const auth = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<WFileManagerRole[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", username: "", email: "", password: "", roleId: "", mustChangePassword: true });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [userResult, roleResult] = await Promise.all([wfilemanagerApi.users(), wfilemanagerApi.roles()]);
      setUsers(userResult.users);
      setRoles(roleResult.roles);
      setForm((current) => ({ ...current, roleId: current.roleId || roleResult.roles.find((role) => role.name === "Read Only")?.id || roleResult.roles.find((role) => role.name !== "Administrator")?.id || "" }));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load users and roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => users.filter((user) => `${user.displayName} ${user.username} ${user.email || ""}`.toLowerCase().includes(q.toLowerCase())), [users, q]);

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Create and remove application users and their dedicated Linux sudo accounts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh users"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1.5 h-4 w-4" /> Create user</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create a user</DialogTitle><DialogDescription>Create a wFileManager account and a matching Linux sudo account.</DialogDescription></DialogHeader>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5"><Label>Display name</Label><Input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></div>
                  <div className="grid gap-1.5"><Label>Username</Label><Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></div>
                </div>
                <div className="grid gap-1.5"><Label>Email (optional)</Label><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label>Temporary password</Label><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label>Role</Label><Select value={form.roleId} onValueChange={(roleId) => setForm({ ...form, roleId })}><SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent></Select></div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.mustChangePassword} onCheckedChange={(value) => setForm({ ...form, mustChangePassword: !!value })} />Force password change on first login</label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={async () => {
                  try {
                    const result = await wfilemanagerApi.createUser({ ...form, email: form.email || undefined });
                    try {
                      await localApi.provisionUser(result.user, form.password);
                    } catch (provisionError) {
                      toast.warning(provisionError instanceof Error ? `Application user created, but Linux account setup failed: ${provisionError.message}` : "Application user created, but Linux account setup failed");
                    }
                    setUsers((current) => [result.user, ...current]);
                    setForm({ displayName: "", username: "", email: "", password: "", roleId: roles.find((role) => role.name === "Read Only")?.id || roles[0]?.id || "", mustChangePassword: true });
                    setOpen(false);
                    toast.success(`Created ${result.user.username}`);
                  } catch (value) {
                    toast.error(value instanceof Error ? value.message : "Creation failed");
                  }
                }} disabled={!form.roleId || form.username.length < 3 || form.password.length < 8}>Create user</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4">
            <div><CardTitle className="text-sm">{users.length} users</CardTitle><CardDescription>{users.filter((user) => user.status === "active").length} active</CardDescription></div>
            <div className="relative w-72"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search users…" className="pl-8" /></div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Access</TableHead><TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Created</TableHead><TableHead className="w-20 text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading users…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No users found.</TableCell></TableRow>
              ) : filtered.map((user) => {
                const assignedRole = roles.find((role) => role.id === user.roleId);
                const isSelf = user.id === auth.user?.id;
                return (
                  <TableRow key={user.id}>
                    <TableCell><div className="font-medium">{user.displayName}</div><div className="text-xs text-muted-foreground">{user.email || "No email"}</div></TableCell>
                    <TableCell className="font-mono text-xs">{user.username}</TableCell>
                    <TableCell><Badge variant={user.isAdmin ? "default" : "secondary"}>{assignedRole?.name || user.roleName || (user.isAdmin ? "Administrator" : "No role")}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{user.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Never"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatRelative(user.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" disabled={isSelf} onClick={() => setDeleteTarget(user)} aria-label={`Delete ${user.username}`} title={isSelf ? "You cannot delete your own account" : "Delete user"}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(value) => { if (!value && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the wFileManager account, active sessions, notifications, path rules and the dedicated Linux user <span className="font-mono">{deleteTarget?.username}</span>. Files owned by that Linux user are not deleted automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                setDeleting(true);
                try {
                  await wfilemanagerApi.deleteUser(deleteTarget.id);
                  try {
                    await localApi.deprovisionUser(deleteTarget);
                  } catch (linuxError) {
                    toast.warning(linuxError instanceof Error ? `Application user deleted, but Linux account cleanup failed: ${linuxError.message}` : "Application user deleted, but Linux account cleanup failed");
                  }
                  setUsers((current) => current.filter((user) => user.id !== deleteTarget.id));
                  toast.success(`Deleted ${deleteTarget.username}`);
                  setDeleteTarget(null);
                } catch (value) {
                  toast.error(value instanceof Error ? value.message : "Unable to delete user");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
