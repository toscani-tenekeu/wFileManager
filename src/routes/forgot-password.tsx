import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell, useDemoAction } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — wFileManager" }] }),
  component: Page,
});

function Page() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { loading, run } = useDemoAction();

  return (
    <AuthShell
      title="Forgot your password?"
      desc="We'll email you a link to reset it."
      footer={<Link to="/login" className="hover:text-foreground">Back to sign in</Link>}
    >
      {sent ? (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-4 text-sm">
          If an account exists for <span className="font-mono">{email}</span>, a reset link is on
          its way.
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setSent(true);
              toast.success("Reset link sent");
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <Button className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
