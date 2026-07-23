import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { isMockMode } from "@/lib/env";
import { ShellNav } from "@/components/shell/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function signOut() {
  "use server";
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { count: activeJobs } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws.workspaceId)
    .in("status", ["pending", "running"]);

  const live = (activeJobs ?? 0) > 0;

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r md:flex">
        <Link
          href="/videos"
          className="flex items-center gap-2.5 px-5 pt-5 pb-2"
        >
          <span
            className={`tally-dot ${live ? "tally-dot--live" : ""}`}
            aria-hidden
          />
          <span className="font-display text-lg font-bold tracking-tight">
            EFFEN
          </span>
        </Link>
        <ShellNav />
        <div className="border-sidebar-border mt-auto border-t px-5 py-4">
          <p className="text-sidebar-foreground/80 truncate text-sm">
            {ws.workspaceName}
          </p>
          <p className="text-sidebar-foreground/50 truncate text-xs">
            {ws.userEmail}
          </p>
          <form action={signOut}>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 -ml-2 h-7 px-2 text-xs"
            >
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/95 sticky top-0 z-10 flex h-12 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
          <Link
            href="/videos"
            className="font-display font-bold tracking-tight md:hidden"
          >
            EFFEN
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {live && (
              <span className="timecode" role="status" aria-live="polite">
                <span
                  className="tally-dot tally-dot--live !size-1.5"
                  aria-hidden
                />
                processing
              </span>
            )}
            {isMockMode() && (
              <Badge
                variant="outline"
                className="border-primary/50 text-primary"
                title="Deterministic development adapters are active. No external providers are called and no spend occurs."
              >
                Mock mode
              </Badge>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
