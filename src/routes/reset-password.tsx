import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthShell, useDemoAction } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password — wFileManager" }] }),
  component: Page,
});

function Page() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { loading, run } = useDemoAction();
  return (
    <AuthShell title="Set a new password" desc="Choose a strong password you haven't used before.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length < 12) return setErr("Use at least 12 characters.");
          if (pw !== confirm) return setErr("Passwords do not match.");
          setErr(null);
          run(async () => {
            toast.success("Password updated. You can now sign in.");
            nav({ to: "/login" });
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label>New password</Label>
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Confirm password</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <Button className="w-full" disabled={loading}>
          {loading ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
