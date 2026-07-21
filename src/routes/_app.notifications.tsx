import { createFileRoute } from "@tanstack/react-router";
import { Bell, CheckCheck, CircleAlert, CircleCheck, CircleX, Info, RefreshCw, Trash2 } from "lucide-react";
import { useNotifications } from "@/lib/notifications";
import { formatDate, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — wFileManager" }] }),
  component: NotificationCenter,
});

function NotificationCenter() {
  const center = useNotifications();

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <h1 className="text-xl font-semibold tracking-tight">Notification center</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Persistent activity notifications. Entries are automatically removed after 7 days.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void center.refresh()} disabled={center.loading}><RefreshCw className={center.loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />Refresh</Button>
          {center.unreadCount > 0 && <Button variant="outline" onClick={() => void center.markAllRead()}><CheckCheck className="mr-2 h-4 w-4" />Mark all read</Button>}
          {center.notifications.length > 0 && <Button variant="destructive" onClick={() => void center.clearAll()}><Trash2 className="mr-2 h-4 w-4" />Clear all</Button>}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div><CardTitle className="text-base">All notifications</CardTitle><CardDescription>{center.unreadCount} unread · {center.notifications.length} total</CardDescription></div>
            <Badge variant="outline">7-day retention</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {center.loading && center.notifications.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading notifications…</div>
          ) : center.notifications.length === 0 ? (
            <div className="p-10 text-center"><Bell className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No notifications</p><p className="mt-1 text-xs text-muted-foreground">File operations and important account events will appear here.</p></div>
          ) : (
            <div className="divide-y divide-border">
              {center.notifications.map((item) => {
                const ToneIcon = item.tone === "success" ? CircleCheck : item.tone === "warning" ? CircleAlert : item.tone === "error" ? CircleX : Info;
                return (
                  <article key={item.id} className={!item.readAt ? "bg-primary/[0.035] p-4 sm:p-5" : "p-4 sm:p-5"}>
                    <div className="flex items-start gap-4">
                      <div className={item.tone === "error" ? "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive" : item.tone === "warning" ? "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-warning/10 text-warning" : "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"}><ToneIcon className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.title}</h2>{!item.readAt && <Badge className="h-5 px-1.5 text-[10px]">Unread</Badge>}<Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">{item.source}</Badge></div>
                        {item.message && <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{formatRelative(item.createdAt)} · {formatDate(item.createdAt)}</span><span>Expires {formatDate(item.expiresAt)}</span></div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!item.readAt && <Button size="sm" variant="outline" onClick={() => void center.markRead(item.id)}>Mark as read</Button>}
                          {item.readAt && <Button size="sm" variant="ghost" onClick={() => void center.markRead(item.id, false)}>Mark unread</Button>}
                          {item.link && <Button size="sm" asChild><a href={item.link} onClick={() => void center.markRead(item.id)}>Open</a></Button>}
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => void center.remove(item.id)} aria-label="Delete notification"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
