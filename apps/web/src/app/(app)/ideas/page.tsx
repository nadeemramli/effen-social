import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { IdeasInbox, type IdeaRow, type SourceVideo } from "./inbox";

export const metadata = { title: "Ideas — EFFEN Studio" };

export default async function IdeasPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  // Source video comes back embedded, so this is a single round trip.
  const { data } = await supabase
    .from("ideas")
    .select(
      "id, video_id, analysis_id, title, angle, status, storytelling_format, persona_relevance, originality_rationale, evidence, copying_risk, copying_risk_note, notes, created_at, updated_at, video:videos(title, platform)",
    )
    .eq("workspace_id", ws.workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as Array<
    IdeaRow & { video: { title: string | null; platform: string } | null }
  >;
  const ideas: IdeaRow[] = rows;
  const videos: Record<string, SourceVideo> = {};
  for (const r of rows) {
    if (r.video_id && r.video) {
      videos[r.video_id] = {
        title: r.video.title,
        platform: r.video.platform,
      };
    }
  }

  const inboxCount = ideas.filter((i) => i.status === "inbox").length;

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Ideas</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {ideas.length === 0
            ? "Idea candidates from your analyses will collect here."
            : `${ideas.length} idea${ideas.length === 1 ? "" : "s"} · ${inboxCount} in the inbox`}
        </p>
      </div>
      <IdeasInbox ideas={ideas} videos={videos} />
    </div>
  );
}
