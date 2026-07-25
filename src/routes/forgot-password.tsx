import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Recover administrator access — wFileManager" }] }),
  component: Page,
});

function Page() {
  return (
    <AuthShell
      title="Recover administrator access"
      desc="Password recovery is performed locally on the server and never by an unauthenticated email link."
      footer={
        <Link to="/login" className="hover:text-foreground">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Open an SSH session as root or with sudo access, then run the installed recovery command.
          </AlertDescription>
        </Alert>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs">
          sudo wfilemanager-reset-admin-password
        </pre>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pro installations can also be recovered after a server reinstall with the saved Recovery Kit.
          wFileManager does not pretend to send reset emails for local administrator accounts.
        </p>
        <Button asChild className="w-full">
          <Link to="/login">Return to sign in</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
