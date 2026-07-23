import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { IdeasInbox, type IdeaRow, type SourceVideo } from "./inbox";

export const metadata = { title: "Ideas — EFFEN Studio" };

export default async function IdeasPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("ideas")
    .select(
      "id, video_id, analysis_id, title, angle, status, storytelling_format, persona_relevance, originality_rationale, evidence, copying_risk, copying_risk_note, notes, created_at, updated_at",
    )
    .eq("workspace_id", ws.workspaceId)
    .order("created_at", { ascending: false });
  const ideas = (data ?? []) as IdeaRow[];

  // Map source videos so cards can link back to where the idea came from.
  const videoIds = [
    ...new Set(ideas.map((i) => i.video_id).filter((id): id is string => !!id)),
  ];
  const videos: Record<string, SourceVideo> = {};
  if (videoIds.length > 0) {
    const { data: rows } = await supabase
      .from("videos")
      .select("id, title, platform")
      .eq("workspace_id", ws.workspaceId)
      .in("id", videoIds);
    for (const v of rows ?? []) {
      videos[v.id as string] = {
        title: (v.title as string | null) ?? null,
        platform: v.platform as string,
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
