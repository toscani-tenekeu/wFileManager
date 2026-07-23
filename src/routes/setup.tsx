import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CircleCheck, Server, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  ADMIN_PASSWORD_POLICY_TEXT,
  administratorPasswordError,
} from "@/lib/admin-password-policy";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "First-run setup — wFileManager" }] }),
  component: Setup,
});

const STEPS = [
  { key: "welcome", label: "Welcome", icon: Server },
  { key: "account", label: "Administrator", icon: User },
  { key: "review", label: "Review", icon: CircleCheck },
] as const;

function Setup() {
  const nav = useNavigate();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "KmerHosting Administrator",
    username: "admin",
    email: "",
    password: "",
    confirm: "",
  });
  const current = STEPS[step];
  const passwordError = form.password ? administratorPasswordError(form.password) : null;
  const confirmationError = form.confirm && form.password !== form.confirm ? "Passwords do not match." : null;

  useEffect(() => {
    if (!auth.loading && auth.user) nav({ to: "/" });
    if (!auth.loading && auth.configured === true && !auth.user) nav({ to: "/login" });
  }, [auth.loading, auth.user, auth.configured, nav]);

  const accountValid = Boolean(
    form.name.trim()
      && form.username.trim().length >= 3
      && !administratorPasswordError(form.password)
      && form.password === form.confirm,
  );

  return (
    <AuthShell title="Set up wFileManager" desc="Create the first local administrator account.">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {step + 1} of {STEPS.length}: <span className="text-foreground">{current.label}</span></span>
          <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

      {current.key === "welcome" && (
        <Card><CardContent className="space-y-3 pt-6 text-sm">
          <p>This creates the first administrator for this wFileManager installation. The account is stored in the selected application database and is separate from Linux system accounts.</p>
          <p className="text-muted-foreground">Administrator terminal access requires re-entering this application password and does not create a dedicated Linux user.</p>
        </CardContent></Card>
      )}

      {current.key === "account" && (
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Display name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>Email (optional)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Password</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Confirm</Label><Input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
          </div>
          <p className={passwordError || confirmationError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {passwordError || confirmationError || ADMIN_PASSWORD_POLICY_TEXT}
          </p>
        </div>
      )}

      {current.key === "review" && (
        <Card><CardContent className="pt-6 text-sm"><dl className="grid grid-cols-3 gap-y-2">
          <dt className="text-muted-foreground">Administrator</dt><dd className="col-span-2">{form.name} ({form.username})</dd>
          <dt className="text-muted-foreground">Email</dt><dd className="col-span-2">{form.email || "Not set"}</dd>
          <dt className="text-muted-foreground">Access</dt><dd className="col-span-2">Full administrator access to this instance</dd>
          <dt className="text-muted-foreground">Linux account</dt><dd className="col-span-2">No Linux user is created</dd>
        </dl></CardContent></Card>
      )}

      <div className="mt-6 flex justify-between">
        <Button variant="outline" disabled={step === 0 || submitting} onClick={() => setStep((s) => s - 1)}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button disabled={current.key === "account" && !accountValid} onClick={() => setStep((s) => s + 1)}>Continue</Button>
        ) : (
          <Button disabled={submitting || !accountValid} onClick={async () => {
            setSubmitting(true); setError(null);
            try {
              await auth.setup({
                instanceName: "wFileManager",
                displayName: form.name,
                username: form.username,
                email: form.email || undefined,
                password: form.password,
              });
              toast.success("wFileManager setup completed");
              nav({ to: "/" });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Setup failed");
            } finally { setSubmitting(false); }
          }}>{submitting ? "Creating administrator…" : "Complete setup"}</Button>
        )}
      </div>
    </AuthShell>
  );
}
