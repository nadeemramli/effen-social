import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import type { HookItem } from "./categories";
import { HookLibrary } from "./library";

export const metadata = { title: "Hook library — EFFEN Studio" };

interface HookRow {
  id: string;
  mechanism: string;
  category: string;
  example: string | null;
  notes: string | null;
  source_analysis_id: string | null;
  created_at: string;
}

export default async function HooksPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  // The source analysis and its video come back embedded — one round trip
  // instead of the hooks → analyses → videos chain.
  const { data } = await supabase
    .from("hooks")
    .select(
      "id, mechanism, category, example, notes, source_analysis_id, created_at, analysis:analyses!source_analysis_id(id, video:videos(id, title))",
    )
    .eq("workspace_id", ws.workspaceId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Array<
    HookRow & {
      analysis: {
        id: string;
        video: { id: string; title: string | null } | null;
      } | null;
    }
  >;

  const hooks: HookItem[] = rows.map((r) => ({
    id: r.id,
    mechanism: r.mechanism,
    category: r.category,
    example: r.example,
    notes: r.notes ?? "",
    createdAt: r.created_at,
    sourceVideo: r.analysis?.video
      ? { id: r.analysis.video.id, title: r.analysis.video.title }
      : null,
  }));

  return <HookLibrary hooks={hooks} />;
}
