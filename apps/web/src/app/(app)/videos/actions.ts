"use server";

import { revalidatePath } from "next/cache";
import { RETRYABLE_STATUSES, type PipelineStatus } from "@effen/core";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { jobs } from "@/lib/adapters/jobs";
import { checkBudget } from "@/lib/budget";
import { estimateAnalysisUsd } from "@/lib/ai/service";
import { transitionVideo } from "@/lib/videos";
import { providerFor } from "@/lib/providers/registry";
import { ProviderError } from "@effen/core";

export interface AnalyzeEstimate {
  itemCount: number;
  estimatedUsd: number;
  perVideo: Array<{
    videoId: string;
    title: string | null;
    estimatedUsd: number;
  }>;
}

/** Pre-run cost estimate shown in the bulk-analysis confirmation dialog. */
export async function estimateAnalysis(
  videoIds: string[],
): Promise<AnalyzeEstimate> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: videos } = await supabase
    .from("videos")
    .select("id, title, duration_seconds")
    .eq("workspace_id", ws.workspaceId)
    .in("id", videoIds);
  const perVideo = (videos ?? []).map((v) => ({
    videoId: v.id,
    title: v.title,
    estimatedUsd: estimateAnalysisUsd(Number(v.duration_seconds ?? 60)),
  }));
  return {
    itemCount: perVideo.length,
    estimatedUsd: perVideo.reduce((a, b) => a + b.estimatedUsd, 0),
    perVideo,
  };
}

export interface AnalyzeResult {
  ok: boolean;
  started: number;
  blocked?: { reason: string; detail: string };
  skipped: string[];
  error?: string;
}

/**
 * Select videos for deep analysis. Budget is checked BEFORE any work is queued;
 * a blocked run marks the videos budget_blocked (visible, retryable) and queues
 * nothing.
 */
export async function analyzeVideos(
  videoIds: string[],
): Promise<AnalyzeResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: videos } = await supabase
    .from("videos")
    .select("id, title, status, duration_seconds")
    .eq("workspace_id", ws.workspaceId)
    .in("id", videoIds);
  if (!videos?.length)
    return { ok: false, started: 0, skipped: [], error: "No matching videos." };

  const eligible: typeof videos = [];
  const skipped: string[] = [];
  for (const v of videos) {
    const s = v.status as PipelineStatus;
    if (
      s === "metadata_ready" ||
      s === "complete" ||
      s === "cancelled" ||
      (RETRYABLE_STATUSES as readonly string[]).includes(s)
    ) {
      eligible.push(v);
    } else {
      skipped.push(v.id);
    }
  }
  if (!eligible.length)
    return {
      ok: false,
      started: 0,
      skipped,
      error: "None of the selected videos are in a state that can be analyzed.",
    };

  const estimatedUsd = eligible.reduce(
    (a, v) => a + estimateAnalysisUsd(Number(v.duration_seconds ?? 60)),
    0,
  );
  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd,
    itemCount: eligible.length,
  });

  if (!decision.allowed) {
    for (const v of eligible) {
      try {
        if (
          v.status === "metadata_ready" ||
          v.status === "complete" ||
          v.status === "cancelled"
        ) {
          await transitionVideo(
            v.id,
            ws.workspaceId,
            "selected_for_analysis",
            "Queued",
          );
        }
        await transitionVideo(
          v.id,
          ws.workspaceId,
          "budget_blocked",
          decision.detail,
        );
      } catch {
        /* per-video state races are non-fatal */
      }
    }
    await writeAudit(ws.workspaceId, ws.userId, "analysis.budget_blocked", {
      reason: decision.reason,
      itemCount: eligible.length,
      estimatedUsd,
    });
    revalidatePath("/videos");
    return {
      ok: false,
      started: 0,
      skipped,
      blocked: { reason: decision.reason, detail: decision.detail },
    };
  }

  let started = 0;
  for (const v of eligible) {
    try {
      await transitionVideo(
        v.id,
        ws.workspaceId,
        "selected_for_analysis",
        "Queued for analysis",
      );
      await jobs().enqueue(
        "acquire_media",
        { workspaceId: ws.workspaceId, videoId: v.id },
        { idempotencyKey: `acquire_media:${v.id}` },
      );
      started++;
    } catch {
      skipped.push(v.id);
    }
  }
  await writeAudit(ws.workspaceId, ws.userId, "analysis.started", {
    count: started,
    estimatedUsd,
  });
  revalidatePath("/videos");
  return { ok: true, started, skipped };
}

/** Retry a failed / blocked / unavailable video. Idempotent via the job key. */
export async function retryVideo(
  videoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: video } = await supabase
    .from("videos")
    .select("id, status, origin")
    .eq("workspace_id", ws.workspaceId)
    .eq("id", videoId)
    .maybeSingle();
  if (!video) return { ok: false, error: "Video not found." };
  const s = video.status as PipelineStatus;

  try {
    if (s === "media_unavailable") {
      await transitionVideo(
        videoId,
        ws.workspaceId,
        "acquiring_media",
        "Retrying media acquisition",
      );
      await jobs().enqueue(
        "acquire_media",
        { workspaceId: ws.workspaceId, videoId },
        { idempotencyKey: `acquire_media:${videoId}` },
      );
    } else if (s === "failed_retryable" || s === "budget_blocked") {
      await transitionVideo(
        videoId,
        ws.workspaceId,
        "selected_for_analysis",
        "Retrying",
      );
      await jobs().enqueue(
        "acquire_media",
        { workspaceId: ws.workspaceId, videoId },
        { idempotencyKey: `acquire_media:${videoId}` },
      );
    } else {
      return { ok: false, error: `Retry isn't available from status "${s}".` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Retry failed.",
    };
  }
  revalidatePath("/videos");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

export async function cancelVideo(
  videoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  try {
    await transitionVideo(
      videoId,
      ws.workspaceId,
      "cancelled",
      "Cancelled by user",
    );
    await writeAudit(ws.workspaceId, ws.userId, "video.cancel", { videoId });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Cancel failed.",
    };
  }
  revalidatePath("/videos");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

export async function deleteVideo(
  videoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .delete()
    .eq("workspace_id", ws.workspaceId)
    .eq("id", videoId);
  if (error) return { ok: false, error: error.message };
  await writeAudit(ws.workspaceId, ws.userId, "video.delete", { videoId });
  revalidatePath("/videos");
  return { ok: true };
}

/** Refresh metric counts only — never triggers analysis or AI spend. */
export async function refreshMetrics(
  videoId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: video } = await supabase
    .from("videos")
    .select("id, platform, external_id, canonical_url")
    .eq("workspace_id", ws.workspaceId)
    .eq("id", videoId)
    .maybeSingle();
  if (!video) return { ok: false, error: "Video not found." };
  if (
    video.platform === "upload" ||
    !video.external_id ||
    !video.canonical_url
  ) {
    return {
      ok: false,
      error: "Uploaded files have no platform metrics to refresh.",
    };
  }
  try {
    const provider = await providerFor(video.platform, ws.workspaceId);
    const { metrics } = await provider.refreshMetrics({
      platform: video.platform,
      canonicalUrl: video.canonical_url,
      externalId: video.external_id,
      kind: "video",
    });
    await supabase.from("video_metrics_snapshots").insert({
      video_id: videoId,
      workspace_id: ws.workspaceId,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      captured_at: metrics.capturedAt,
    });
  } catch (e) {
    const msg =
      e instanceof ProviderError ? e.message : "Metrics refresh failed.";
    return { ok: false, error: msg };
  }
  revalidatePath("/videos");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}
