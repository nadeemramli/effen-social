import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { AddSourceForm, SourcesList, type SourceRow } from "./sources-client";

export const metadata = { title: "Sources — EFFEN Studio" };

export default async function SourcesPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const [{ data: sources }, { data: videoRows }] = await Promise.all([
    supabase
      .from("sources")
      .select(
        "id, platform, external_id, handle, display_name, avatar_url, follower_count, profile_url, tags, enabled, last_discovered_at, created_at",
      )
      .eq("workspace_id", ws.workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("videos")
      .select("source_id")
      .eq("workspace_id", ws.workspaceId)
      .not("source_id", "is", null),
  ]);

  const counts = new Map<string, number>();
  for (const v of videoRows ?? []) {
    const id = v.source_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const rows: SourceRow[] = (sources ?? []).map((s) => ({
    id: s.id as string,
    platform: s.platform as SourceRow["platform"],
    handle: (s.handle as string | null) ?? null,
    display_name: (s.display_name as string | null) ?? null,
    avatar_url: (s.avatar_url as string | null) ?? null,
    follower_count: (s.follower_count as number | null) ?? null,
    profile_url: (s.profile_url as string | null) ?? null,
    tags: (s.tags as string[] | null) ?? [],
    enabled: Boolean(s.enabled),
    last_discovered_at: (s.last_discovered_at as string | null) ?? null,
    videoCount: counts.get(s.id as string) ?? 0,
  }));

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sources</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rows.length === 0
              ? "Watch creators and pull their recent videos as metadata."
              : `${rows.length} source${rows.length === 1 ? "" : "s"} · ${rows.filter((s) => s.enabled).length} watching`}
          </p>
        </div>
      </div>

      <AddSourceForm />

      {rows.length === 0 ? (
        <div className="border-border mt-10 rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-lg font-semibold">
            Build your watchlist
          </p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Sources let you watch creators you learn from. Paste a profile URL
            above and we pull their recent videos as metadata — cheap and
            instant. Deep analysis is a separate step you run per video from the
            library.
          </p>
        </div>
      ) : (
        <SourcesList sources={rows} />
      )}
    </div>
  );
}
