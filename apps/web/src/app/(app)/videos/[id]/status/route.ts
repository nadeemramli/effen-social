import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Lightweight pipeline-status poll for the video detail page. Returns just the
 * fields the progress UI needs so live polling doesn't re-render the whole
 * route (middleware + layout + every detail query) on each tick.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const [{ data: video }, { data: events }] = await Promise.all([
    supabase
      .from("videos")
      .select("status, status_detail, last_error")
      .eq("id", id)
      .eq("workspace_id", ws.workspaceId)
      .maybeSingle(),
    supabase
      .from("pipeline_events")
      .select("from_status, to_status, detail, created_at")
      .eq("video_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (!video) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    status: video.status,
    statusDetail: video.status_detail,
    lastError: video.last_error,
    events: events ?? [],
  });
}
