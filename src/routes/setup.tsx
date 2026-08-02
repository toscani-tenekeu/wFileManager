import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleCheck, Server, User } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  ADMIN_PASSWORD_POLICY_TEXT,
  administratorPasswordError,
} from "@/lib/admin-password-policy";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "First-run setup - wFileManager" }] }),
  component: Setup,
});

const STEPS = [
  { key: "welcome", label: "Welcome", icon: Server },
  { key: "account", label: "Administrator", icon: User },
  { key: "review", label: "Review", icon: CircleCheck },
] as const;

const LEGACY_PRO_INSTALLATION =
  String(import.meta.env.VITE_WFILEMANAGER_DATABASE_MODE || "sqlite").toLowerCase() === "supabase";

function Setup() {
  const nav = useNavigate();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "Administrator",
    username: "admin",
    email: "",
    password: "",
    confirm: "",
  });
  const current = STEPS[step];
  const passwordError = form.password ? administratorPasswordError(form.password) : null;
  const confirmationError =
    form.confirm && form.password !== form.confirm ? "Passwords do not match." : null;
  const accountValid = Boolean(
    form.name.trim() &&
    form.username.trim().length >= 3 &&
    !administratorPasswordError(form.password) &&
    form.password === form.confirm,
  );

  useEffect(() => {
    if (!LEGACY_PRO_INSTALLATION && !auth.loading && auth.user) nav({ to: "/" });
    if (!LEGACY_PRO_INSTALLATION && !auth.loading && auth.configured === true && !auth.user)
      nav({ to: "/login" });
  }, [auth.loading, auth.user, auth.configured, nav]);

  const completeSetup = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await auth.setup({
        instanceName: "wFileManager",
        displayName: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
      });
      toast.success("wFileManager setup completed");
      nav({ to: "/" });
    } catch (value) {
      setError(value instanceof Error ? value.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (LEGACY_PRO_INSTALLATION) {
    return (
      <AuthShell title="Pro service retirement pending" desc="This installation is being retired.">
        <Alert>
          <AlertDescription>
            The authenticated server heartbeat will delete the managed account before removing
            wFileManager locally. Ordinary server files and system packages are not removed.
          </AlertDescription>
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set up wFileManager" desc="Create the first administrator.">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {step + 1} of {STEPS.length}: {current.label}
          </span>
          <span>{Math.round(((step + 1) / STEPS.length) * 100)}%</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {current.key === "welcome" && (
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>Create the administrator account for this server.</p>
            <p className="text-muted-foreground">
              Application data is stored locally in SQLite. The account is not a Linux user.
            </p>
          </CardContent>
        </Card>
      )}

      {current.key === "account" && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Display name</Label>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Username</Label>
            <Input
              autoComplete="username"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Email (optional)</Label>
            <Input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Confirm</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.confirm}
                onChange={(event) => setForm({ ...form, confirm: event.target.value })}
              />
            </div>
          </div>
          <p
            className={
              passwordError || confirmationError
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {passwordError || confirmationError || ADMIN_PASSWORD_POLICY_TEXT}
          </p>
        </div>
      )}

      {current.key === "review" && (
        <Card>
          <CardContent className="pt-6 text-sm">
            <dl className="grid grid-cols-3 gap-y-2">
              <dt className="text-muted-foreground">Admin</dt>
              <dd className="col-span-2">
                {form.name} ({form.username})
              </dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="col-span-2">{form.email || "Not set"}</dd>
              <dt className="text-muted-foreground">Data</dt>
              <dd className="col-span-2">SQLite on this server</dd>
            </dl>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex justify-between">
        <Button
          variant="outline"
          disabled={step === 0 || submitting}
          onClick={() => setStep((value) => value - 1)}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            disabled={current.key === "account" && !accountValid}
            onClick={() => setStep((value) => value + 1)}
          >
            Continue
          </Button>
        ) : (
          <Button disabled={submitting || !accountValid} onClick={() => void completeSetup()}>
            {submitting ? "Creating administrator..." : "Complete setup"}
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
