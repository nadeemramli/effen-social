import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { NewScriptButton } from "./new-script-button";

export const metadata = { title: "Scripts — EFFEN Studio" };

const STATUS_STYLES: Record<string, string> = {
  draft: "",
  revising: "border-primary/60 text-primary",
  ready: "border-[var(--effen-teal)] text-[var(--effen-teal)]",
  recorded: "",
  archived: "opacity-60",
};

export default async function ScriptsPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, title, status, stage, current_version, updated_at, idea_id")
    .eq("workspace_id", ws.workspaceId)
    .order("updated_at", { ascending: false });

  const rows = scripts ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Scripts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Topic → Research → Hook → Script. A script is only
            &ldquo;Ready&rdquo; when you mark it ready.
          </p>
        </div>
        <NewScriptButton />
      </div>

      {rows.length === 0 ? (
        <div className="border-border mt-10 rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-lg font-semibold">No scripts yet</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Start from a shortlisted idea in your{" "}
            <Link href="/ideas" className="underline">
              Ideas inbox
            </Link>
            , or begin with a blank topic.
          </p>
          <div className="mt-4">
            <NewScriptButton />
          </div>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={
                  s.stage === "script" && s.current_version > 0
                    ? `/scripts/${s.id}`
                    : `/scripts/${s.id}/wizard`
                }
                className="bg-card border-border hover:bg-accent/40 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {s.current_version > 0
                      ? `v${s.current_version}`
                      : `Wizard: ${s.stage}`}{" "}
                    · updated {new Date(s.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`capitalize ${STATUS_STYLES[s.status] ?? ""}`}
                >
                  {s.status}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
