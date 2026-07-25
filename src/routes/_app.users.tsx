import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { wfilemanagerApi, type AuthUser, type WFileManagerRole } from "@/lib/wfilemanager-api";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "Users — wFileManager" }] }),
  component: Users,
});

const emptyCreate = {
  displayName: "",
  username: "",
  email: "",
  password: "",
  roleId: "",
  allowedPaths: "/var/www",
  mustChangePassword: true,
};

function strongPassword(value: string) {
  return value.length >= 12 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
}

function parsePaths(value: string) {
  return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

function pathsText(user: AuthUser | null) {
  return (user?.allowedPaths || []).join("\n");
}

function Users() {
  const auth = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<WFileManagerRole[]>([]);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AuthUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyCreate);
  const [edit, setEdit] = useState({
    displayName: "",
    email: "",
    password: "",
    roleId: "",
    status: "active" as "active" | "disabled" | "invited",
    allowedPaths: "",
    mustChangePassword: true,
  });

  const assignableRoles = useMemo(
    () => roles.filter((role) => role.name.toLowerCase() !== "administrator"),
    [roles],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [userResult, roleResult] = await Promise.all([
        wfilemanagerApi.users(),
        wfilemanagerApi.roles(),
      ]);
      setUsers(userResult.users);
      setRoles(roleResult.roles);
      const fallback =
        roleResult.roles.find((role) => role.name === "Read Only")?.id ||
        roleResult.roles.find((role) => role.name.toLowerCase() !== "administrator")?.id ||
        "";
      setForm((current) => ({ ...current, roleId: current.roleId || fallback }));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load users and roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!editTarget) return;
    setEdit({
      displayName: editTarget.displayName,
      email: editTarget.email || "",
      password: "",
      roleId: editTarget.roleId || assignableRoles[0]?.id || "",
      status: editTarget.status,
      allowedPaths: pathsText(editTarget),
      mustChangePassword: editTarget.mustChangePassword,
    });
  }, [editTarget, assignableRoles]);

  const filtered = useMemo(
    () =>
      users.filter((user) =>
        `${user.displayName} ${user.username} ${user.email || ""}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
    [users, q],
  );

  const create = async () => {
    setSaving(true);
    try {
      const result = await wfilemanagerApi.createUser({
        displayName: form.displayName.trim(),
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
        roleId: form.roleId,
        mustChangePassword: form.mustChangePassword,
        allowedPaths: parsePaths(form.allowedPaths),
      });
      setUsers((current) => [result.user, ...current]);
      setForm({
        ...emptyCreate,
        roleId:
          assignableRoles.find((role) => role.name === "Read Only")?.id ||
          assignableRoles[0]?.id ||
          "",
      });
      setCreateOpen(false);
      toast.success(`Created ${result.user.username}`);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Creation failed");
    } finally {
      setSaving(false);
    }
  };

  const update = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const result = await wfilemanagerApi.updateUser(editTarget.id, {
        displayName: edit.displayName.trim(),
        email: edit.email.trim() || null,
        roleId: edit.roleId,
        status: edit.status,
        mustChangePassword: edit.mustChangePassword,
        allowedPaths: parsePaths(edit.allowedPaths),
        ...(edit.password ? { password: edit.password } : {}),
      });
      setUsers((current) =>
        current.map((user) => (user.id === result.user.id ? result.user : user)),
      );
      setEditTarget(null);
      toast.success(`${result.user.username} updated`);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await wfilemanagerApi.deleteUser(deleteTarget.id);
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id));
      toast.success(`Deleted ${deleteTarget.username}`);
      setDeleteTarget(null);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to delete user");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage application accounts, roles and the exact server paths each account may access.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh users">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-1.5 h-4 w-4" /> Create user
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create a user</DialogTitle>
                <DialogDescription>
                  Accounts are denied filesystem access unless at least one absolute allowed path is
                  configured.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Display name</Label>
                    <Input
                      value={form.displayName}
                      onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Username</Label>
                    <Input
                      value={form.username}
                      onChange={(event) => setForm({ ...form, username: event.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Email (optional)</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Role</Label>
                    <Select value={form.roleId} onValueChange={(roleId) => setForm({ ...form, roleId })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a role" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableRoles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>Temporary password</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    At least 12 characters with uppercase, lowercase and a number.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label>Allowed server paths</Label>
                  <Textarea
                    className="min-h-28 font-mono text-xs"
                    value={form.allowedPaths}
                    onChange={(event) => setForm({ ...form, allowedPaths: event.target.value })}
                    placeholder={"/var/www/example.com\n/home/customer"}
                  />
                  <p className="text-xs text-muted-foreground">
                    One absolute path per line. Access is recursive. Empty means no filesystem access.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.mustChangePassword}
                    onCheckedChange={(value) => setForm({ ...form, mustChangePassword: !!value })}
                  />
                  Force password change on first login
                </label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void create()}
                  disabled={
                    saving ||
                    !form.roleId ||
                    form.username.trim().length < 3 ||
                    form.displayName.trim().length < 2 ||
                    !strongPassword(form.password)
                  }
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create user
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm">{users.length} users</CardTitle>
              <CardDescription>
                {users.filter((user) => user.status === "active").length} active
              </CardDescription>
            </div>
            <div className="relative w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search users…" className="pl-8" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Paths</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Loading users…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((user) => {
                  const assignedRole = roles.find((role) => role.id === user.roleId);
                  const isSelf = user.id === auth.user?.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium">{user.displayName}</div>
                        <div className="text-xs text-muted-foreground">{user.email || "No email"}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{user.username}</TableCell>
                      <TableCell>
                        <Badge variant={user.isAdmin ? "default" : "secondary"}>
                          {assignedRole?.name || user.roleName || (user.isAdmin ? "Administrator" : "No role")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-52">
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {user.isAdmin ? "/" : user.allowedPaths?.length ? user.allowedPaths.join(", ") : "Denied"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={isSelf || user.isAdmin}
                          onClick={() => setEditTarget(user)}
                          aria-label={`Edit ${user.username}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={isSelf || user.isAdmin}
                          onClick={() => setDeleteTarget(user)}
                          aria-label={`Delete ${user.username}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.username}</DialogTitle>
            <DialogDescription>
              Changing the password or disabling the account revokes all of its active sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Display name</Label>
                <Input value={edit.displayName} onChange={(event) => setEdit({ ...edit, displayName: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={edit.email} onChange={(event) => setEdit({ ...edit, email: event.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Role</Label>
                <Select value={edit.roleId} onValueChange={(roleId) => setEdit({ ...edit, roleId })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={edit.status} onValueChange={(status) => setEdit({ ...edit, status: status as typeof edit.status })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="invited">Invited</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Allowed server paths</Label>
              <Textarea className="min-h-28 font-mono text-xs" value={edit.allowedPaths} onChange={(event) => setEdit({ ...edit, allowedPaths: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>New temporary password (optional)</Label>
              <Input type="password" value={edit.password} onChange={(event) => setEdit({ ...edit, password: event.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={edit.mustChangePassword} onCheckedChange={(value) => setEdit({ ...edit, mustChangePassword: !!value })} />
              Force password change
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              disabled={
                saving ||
                edit.displayName.trim().length < 2 ||
                !edit.roleId ||
                (Boolean(edit.password) && !strongPassword(edit.password))
              }
              onClick={() => void update()}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(value) => !value && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account, sessions, notifications and path rules. Server files are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => { event.preventDefault(); void remove(); }}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
