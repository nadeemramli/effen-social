"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { jobs } from "@/lib/adapters/jobs";
import { checkBudget } from "@/lib/budget";
import { estimateAnalysisUsd } from "@/lib/ai/service";
import { transitionVideo } from "@/lib/videos";

/** User notes live in analysis_notes — never mixed with AI output. */
export async function saveAnalysisNotes(
  videoId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: video } = await supabase
    .from("videos")
    .select("id")
    .eq("id", videoId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!video) return { ok: false, error: "Video not found." };
  const { error } = await supabase.from("analysis_notes").upsert({
    video_id: videoId,
    workspace_id: ws.workspaceId,
    content: content.slice(0, 20_000),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Regenerate the analysis as a NEW version (never overwrites, never touches
 * user notes). Bypasses the content cache on purpose; budget-checked.
 */
export async function regenerateAnalysis(
  videoId: string,
): Promise<{ ok: boolean; error?: string; blocked?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: video } = await supabase
    .from("videos")
    .select("id, status, duration_seconds")
    .eq("id", videoId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!video) return { ok: false, error: "Video not found." };
  if (video.status !== "complete")
    return {
      ok: false,
      error: "Regeneration is only available on a completed analysis.",
    };

  const estimatedUsd = estimateAnalysisUsd(
    Number(video.duration_seconds ?? 60),
  );
  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd,
    itemCount: 1,
  });
  if (!decision.allowed) {
    await transitionVideo(
      videoId,
      ws.workspaceId,
      "selected_for_analysis",
      "Queued for regeneration",
    );
    await transitionVideo(
      videoId,
      ws.workspaceId,
      "budget_blocked",
      decision.detail,
    );
    revalidatePath(`/videos/${videoId}`);
    return { ok: false, blocked: decision.detail };
  }

  await transitionVideo(
    videoId,
    ws.workspaceId,
    "selected_for_analysis",
    "Regenerating analysis",
  );
  await jobs().enqueue(
    "acquire_media",
    { workspaceId: ws.workspaceId, videoId, params: { force: true } },
    { idempotencyKey: `acquire_media:${videoId}:regen:${Date.now()}` },
  );
  await writeAudit(ws.workspaceId, ws.userId, "analysis.regenerate", {
    videoId,
    estimatedUsd,
  });
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

const saveHookSchema = z.object({
  mechanism: z.string().min(10),
  category: z.string().min(2),
  analysisId: z.string().uuid(),
});

/** Save the analyzed hook mechanism (abstract, reusable) into the hook library. */
export async function saveHookFromAnalysis(
  input: z.infer<typeof saveHookSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const parsed = saveHookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid hook data." };
  const supabase = await supabaseServer();
  const { data: analysis } = await supabase
    .from("analyses")
    .select("id")
    .eq("id", parsed.data.analysisId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!analysis) return { ok: false, error: "Analysis not found." };
  const { error } = await supabase.from("hooks").insert({
    workspace_id: ws.workspaceId,
    mechanism: parsed.data.mechanism,
    category: parsed.data.category,
    source_analysis_id: parsed.data.analysisId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hooks");
  return { ok: true };
}
