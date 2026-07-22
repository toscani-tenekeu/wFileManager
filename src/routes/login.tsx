import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { localApi } from "@/lib/local-api";
import { wfilemanagerApi } from "@/lib/wfilemanager-api";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — wFileManager" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const auth = useAuth();
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!auth.loading && auth.user) nav({ to: "/" });
    if (!auth.loading && auth.configured === false) nav({ to: "/setup" });
  }, [auth.loading, auth.user, auth.configured, nav]);

  return (
    <AuthShell
      title="Sign in"
      desc="Access your wFileManager administration panel."
    >
      {err && <Alert variant="destructive" className="mb-4"><AlertDescription>{err}</AlertDescription></Alert>}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setSubmitting(true);
          try {
            await auth.login(user, pass, remember);
            try {
              await localApi.provisionSelf(pass);
            } catch (provisionError) {
              toast.warning(provisionError instanceof Error ? `Signed in, but Linux account setup failed: ${provisionError.message}` : "Signed in, but Linux account setup failed");
            }
            await wfilemanagerApi.createNotification({
              title: "Signed in",
              message: `A new wFileManager session was started for ${user}.`,
              tone: "info",
              link: "/account",
              source: "authentication",
            }).catch(() => undefined);
            toast.success(`Welcome back, ${user}`);
            nav({ to: "/" });
          } catch (error) {
            setErr(error instanceof Error ? error.message : "Sign-in failed");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="user">Username or email</Label>
          <Input id="user" autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pass">Password</Label>
          <Input id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
          <span>Keep me signed in on this device</span>
        </label>
        <Button type="submit" className="w-full" disabled={submitting || !user || !pass}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
