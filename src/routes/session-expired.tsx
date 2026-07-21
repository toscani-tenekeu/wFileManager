import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

export const Route = createFileRoute("/session-expired")({
  head: () => ({ meta: [{ title: "Session expired — wFileManager" }] }),
  component: SessionExpiredPage,
});

function SessionExpiredPage() {
  return (
    <AuthShell
      title="Session expired"
      desc="You were signed out to protect your account."
    >
      <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Clock className="h-4 w-4 text-primary" />
          Idle timeout reached
        </div>
        <p className="mt-2">
          For security, wFileManager signs out inactive sessions after the timeout configured in
          Settings → Security.
        </p>
      </div>
      <Button asChild className="mt-6 w-full">
        <Link to="/login">Sign in again</Link>
      </Button>
    </AuthShell>
  );
}
