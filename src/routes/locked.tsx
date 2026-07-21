import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/locked")({
  head: () => ({ meta: [{ title: "Account locked — wFileManager" }] }),
  component: LockedPage,
});

function LockedPage() {
  return (
    <AuthShell
      title="Account locked"
      desc="Too many failed sign-in attempts."
      footer={
        <Link to="/forgot-password" className="hover:text-foreground">
          Reset your password
        </Link>
      }
    >
      <Alert variant="destructive" className="mb-4">
        <Lock className="h-4 w-4" />
        <AlertDescription>
          For your protection this account has been temporarily locked. Try again in 15 minutes or
          contact your system administrator.
        </AlertDescription>
      </Alert>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Failed attempts from this device: 5</p>
        <p>Locked until: 15 minutes from now</p>
        <p>IP address: 192.168.1.42</p>
      </div>
      <Button asChild variant="outline" className="mt-6 w-full">
        <Link to="/login">Back to sign in</Link>
      </Button>
    </AuthShell>
  );
}
