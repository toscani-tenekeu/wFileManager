import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Password recovery — wFileManager" }] }),
  component: Page,
});

function Page() {
  return (
    <AuthShell
      title="Password recovery"
      desc="This installation does not accept public browser reset tokens for administrator accounts."
      footer={
        <Link to="/login" className="hover:text-foreground">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Reset the administrator password from an authenticated server shell. This prevents account
            takeover through forged browser reset links.
          </AlertDescription>
        </Alert>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs">
          sudo wfilemanager-reset-admin-password
        </pre>
        <Button asChild className="w-full">
          <Link to="/login">Return to sign in</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
