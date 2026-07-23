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

  const { data } = await supabase
    .from("hooks")
    .select(
      "id, mechanism, category, example, notes, source_analysis_id, created_at",
    )
    .eq("workspace_id", ws.workspaceId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as HookRow[];

  // Resolve source analyses back to their videos so cards can link to /videos/[videoId].
  const analysisIds = [
    ...new Set(
      rows.map((r) => r.source_analysis_id).filter((id): id is string => !!id),
    ),
  ];
  const videoByAnalysis = new Map<
    string,
    { id: string; title: string | null }
  >();
  if (analysisIds.length > 0) {
    const { data: analyses } = await supabase
      .from("analyses")
      .select("id, video_id")
      .in("id", analysisIds);
    const videoIds = [
      ...new Set(
        (analyses ?? [])
          .map((a) => a.video_id as string | null)
          .filter((id): id is string => !!id),
      ),
    ];
    if (videoIds.length > 0) {
      const { data: videos } = await supabase
        .from("videos")
        .select("id, title")
        .eq("workspace_id", ws.workspaceId)
        .in("id", videoIds);
      const videoById = new Map(
        (videos ?? []).map((v) => [
          v.id as string,
          { id: v.id as string, title: (v.title as string | null) ?? null },
        ]),
      );
      for (const a of analyses ?? []) {
        const video = a.video_id
          ? videoById.get(a.video_id as string)
          : undefined;
        if (video) videoByAnalysis.set(a.id as string, video);
      }
    }
  }

  const hooks: HookItem[] = rows.map((r) => ({
    id: r.id,
    mechanism: r.mechanism,
    category: r.category,
    example: r.example,
    notes: r.notes ?? "",
    createdAt: r.created_at,
    sourceVideo: r.source_analysis_id
      ? (videoByAnalysis.get(r.source_analysis_id) ?? null)
      : null,
  }));

  return <HookLibrary hooks={hooks} />;
}
