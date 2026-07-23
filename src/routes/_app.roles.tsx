import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { PERMISSION_KEYS, type PermissionKey } from "@/lib/demo/data";
import { wfilemanagerApi, type WFileManagerRole } from "@/lib/wfilemanager-api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/roles")({
  head: () => ({ meta: [{ title: "Roles & permissions — wFileManager" }] }),
  component: Roles,
});

const GROUPS: Array<{ name: string; permissions: PermissionKey[] }> = [
  { name: "Browse and read", permissions: ["browse", "view", "preview", "read", "download", "calculate_checksums"] },
  { name: "Create and modify", permissions: ["create_files", "create_directories", "edit", "rename", "copy", "move", "upload"] },
  { name: "Delete and archive", permissions: ["delete", "restore", "permanently_delete", "compress", "extract"] },
  { name: "Linux metadata", permissions: ["change_permissions", "change_owner", "change_group", "create_symlinks"] },
  { name: "Administration", permissions: ["manage_users", "manage_roles"] },
];

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function roleDraft(role: WFileManagerRole) {
  return {
    name: role.name,
    description: role.description,
    permissions: role.permissions.filter((permission) => permission !== "use_terminal"),
  };
}

function Roles() {
  const [roles, setRoles] = useState<WFileManagerRole[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", permissions: [] as string[] });
  const [newRole, setNewRole] = useState({ name: "", description: "", permissions: ["browse", "view", "read"] as string[] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const active = useMemo(() => roles.find((role) => role.id === activeId) || null, [roles, activeId]);
  const administratorLocked = Boolean(active?.isSystem && active.name === "Administrator");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await wfilemanagerApi.roles();
      const normalized = result.roles.map((role) => ({
        ...role,
        permissions: role.permissions.filter((permission) => permission !== "use_terminal"),
      }));
      setRoles(normalized);
      const selected = normalized.find((role) => role.id === activeId) || normalized[0] || null;
      setActiveId(selected?.id || null);
      if (selected) setDraft(roleDraft(selected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (active) setDraft(roleDraft(active));
  }, [activeId]);

  const toggle = (permission: PermissionKey, target: "draft" | "new") => {
    if (target === "draft") {
      if (administratorLocked) return;
      setDraft((current) => ({
        ...current,
        permissions: current.permissions.includes(permission)
          ? current.permissions.filter((value) => value !== permission)
          : [...current.permissions, permission],
      }));
      return;
    }
    setNewRole((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((value) => value !== permission)
        : [...current.permissions, permission],
    }));
  };

  const save = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const result = await wfilemanagerApi.updateRole({
        id: active.id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        permissions: draft.permissions.filter((permission) => permission !== "use_terminal"),
      });
      const normalized = { ...result.role, permissions: result.role.permissions.filter((permission) => permission !== "use_terminal") };
      setRoles((current) => current.map((role) => role.id === normalized.id ? normalized : role));
      setDraft(roleDraft(normalized));
      toast.success(`${normalized.name} saved`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to save role");
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    setSaving(true);
    try {
      const result = await wfilemanagerApi.createRole({
        ...newRole,
        permissions: newRole.permissions.filter((permission) => permission !== "use_terminal"),
      });
      const normalized = { ...result.role, permissions: result.role.permissions.filter((permission) => permission !== "use_terminal") };
      setRoles((current) => [...current, normalized]);
      setActiveId(normalized.id);
      setDraft(roleDraft(normalized));
      setNewRole({ name: "", description: "", permissions: ["browse", "view", "read"] });
      setNewOpen(false);
      toast.success(`${normalized.name} created`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to create role");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await wfilemanagerApi.deleteRole(active.id);
      const remaining = roles.filter((role) => role.id !== active.id);
      setRoles(remaining);
      setActiveId(remaining[0]?.id || null);
      if (remaining[0]) setDraft(roleDraft(remaining[0]));
      setDeleteOpen(false);
      toast.success(`${active.name} deleted`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to delete role");
    } finally {
      setSaving(false);
    }
  };

  const permissionGrid = (
    permissions: string[],
    target: "draft" | "new",
    disabled = false,
  ) => (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <section key={group.name}>
          <h3 className="mb-2 text-sm font-medium">{group.name}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.permissions.map((permission) => {
              const checked = permissions.includes(permission);
              return (
                <label key={permission} className={cn("flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm", !disabled && "cursor-pointer hover:bg-muted/50", checked && "border-primary/40 bg-primary/5", disabled && "cursor-not-allowed opacity-80")}>
                  <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(permission, target)} />
                  <span className="truncate capitalize">{labelize(permission)}</span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Roles & permissions</h1>
            <p className="text-sm text-muted-foreground">Control file-management permissions for application users. Root terminal access is reserved for administrators and is not assignable here.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh roles"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
          <Button onClick={() => setNewOpen(true)}><Plus className="mr-1.5 h-4 w-4" />New role</Button>
        </div>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Roles</CardTitle><CardDescription>{roles.length} defined</CardDescription></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[650px]">
              {loading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading roles…</div>
              ) : (
                <ul className="divide-y divide-border">
                  {roles.map((role) => (
                    <li key={role.id}>
                      <button onClick={() => setActiveId(role.id)} className={cn("flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50", activeId === role.id && "bg-muted")}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{role.name}</span>{role.isSystem && <Badge variant="outline" className="h-4 px-1 text-[10px]">system</Badge>}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{role.members} member{role.members === 1 ? "" : "s"} · {role.permissions.length} permissions</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          {!active ? (
            <CardContent className="grid min-h-[480px] place-items-center text-sm text-muted-foreground">Select or create a role.</CardContent>
          ) : (
            <>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><CardTitle className="text-base">{active.name}</CardTitle><CardDescription>{active.members} assigned user{active.members === 1 ? "" : "s"}</CardDescription></div>
                  <div className="flex gap-2">
                    {!active.isSystem && <Button size="sm" variant="outline" className="text-destructive" disabled={active.members > 0 || saving} onClick={() => setDeleteOpen(true)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>}
                    <Button size="sm" disabled={saving || administratorLocked || !draft.name.trim()} onClick={() => void save()}>{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}Save</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {administratorLocked && <Alert><AlertDescription>The Administrator role keeps complete application access, including the administrator-only terminal.</AlertDescription></Alert>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5"><Label>Role name</Label><Input value={draft.name} disabled={administratorLocked} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
                  <div className="grid gap-1.5 sm:col-span-2"><Label>Description</Label><Textarea value={draft.description} disabled={administratorLocked} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permission matrix</p><p className="mt-1 text-xs text-muted-foreground">These permissions control file and account operations. Terminal access is not a role permission.</p></div>
                  {!administratorLocked && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, permissions: [...PERMISSION_KEYS] })}>Select all</Button><Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, permissions: [] })}>Clear</Button></div>}
                </div>
                {permissionGrid(draft.permissions, "draft", administratorLocked)}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Create role</DialogTitle><DialogDescription>Create a reusable application role. Administrator terminal access cannot be delegated.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5"><Label>Name</Label><Input value={newRole.name} onChange={(event) => setNewRole({ ...newRole, name: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Description</Label><Textarea value={newRole.description} onChange={(event) => setNewRole({ ...newRole, description: event.target.value })} /></div>
            <div className="max-h-[420px] overflow-y-auto pr-1">{permissionGrid(newRole.permissions, "new")}</div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button><Button disabled={saving || newRole.name.trim().length < 2} onClick={() => void create()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create role</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {active?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the role permanently. Roles assigned to users cannot be deleted.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void remove(); }}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
