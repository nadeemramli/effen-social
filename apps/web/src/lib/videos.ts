import "server-only";
import {
  assertTransition,
  engagementRate,
  outlierScore,
  type OutlierResult,
  type PipelineStatus,
} from "@effen/core";
import { supabaseServer } from "@/lib/supabase/server";

export interface VideoRow {
  id: string;
  workspace_id: string;
  source_id: string | null;
  platform: "youtube" | "instagram" | "tiktok" | "upload";
  origin: "url" | "discovery" | "upload";
  external_id: string | null;
  canonical_url: string | null;
  title: string | null;
  caption: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  hashtags: string[];
  language: string | null;
  status: PipelineStatus;
  status_detail: string | null;
  last_error: string | null;
  media_checksum: string | null;
  playback_embed_url: string | null;
  upload_file_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricsRow {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  captured_at: string;
}

export interface VideoWithDerived extends VideoRow {
  metrics: MetricsRow | null;
  engagement: number | null;
  outlier: OutlierResult | null;
  sourceHandle: string | null;
  sourceTags: string[];
  hasAnalysis: boolean;
}

/**
 * Transition a video's pipeline status with state-machine validation and an
 * audit event. Used by web-tier actions; the worker has its own equivalent.
 */
export async function transitionVideo(
  videoId: string,
  workspaceId: string,
  to: PipelineStatus,
  detail?: string,
): Promise<void> {
  const supabase = await supabaseServer();
  const { data: video } = await supabase
    .from("videos")
    .select("status")
    .eq("id", videoId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!video) throw new Error("Video not found");
  const from = video.status as PipelineStatus;
  assertTransition(from, to);
  const { error } = await supabase
    .from("videos")
    .update({
      status: to,
      status_detail: detail ?? null,
      ...(to === "selected_for_analysis" ? { last_error: null } : {}),
    })
    .eq("id", videoId)
    .eq("workspace_id", workspaceId)
    .eq("status", from); // optimistic: ignore if a concurrent transition won
  if (error) throw new Error(error.message);
  await supabase.from("pipeline_events").insert({
    video_id: videoId,
    workspace_id: workspaceId,
    from_status: from,
    to_status: to,
    detail: detail ?? null,
  });
}

/** Load library videos with latest metrics, engagement, and outlier score. */
export async function loadLibrary(
  workspaceId: string,
): Promise<VideoWithDerived[]> {
  const supabase = await supabaseServer();
  const [
    { data: videos },
    { data: snapshots },
    { data: sources },
    { data: analyses },
  ] = await Promise.all([
    supabase
      .from("videos")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("video_metrics_snapshots")
      .select("video_id, views, likes, comments, shares, saves, captured_at")
      .eq("workspace_id", workspaceId)
      .order("captured_at", { ascending: false })
      .limit(2000),
    supabase
      .from("sources")
      .select("id, handle, tags")
      .eq("workspace_id", workspaceId),
    supabase
      .from("analyses")
      .select("video_id")
      .eq("workspace_id", workspaceId),
  ]);

  const latestByVideo = new Map<string, MetricsRow>();
  for (const s of snapshots ?? []) {
    if (!latestByVideo.has(s.video_id)) {
      latestByVideo.set(s.video_id, {
        views: s.views,
        likes: s.likes,
        comments: s.comments,
        shares: s.shares,
        saves: s.saves,
        captured_at: s.captured_at,
      });
    }
  }
  const sourceById = new Map((sources ?? []).map((s) => [s.id, s]));
  const analyzed = new Set((analyses ?? []).map((a) => a.video_id));

  const rows = (videos ?? []) as VideoRow[];

  // Outlier peers: same source's other videos, newest published first.
  const peersBySource = new Map<
    string,
    Array<{ id: string; views: number | null; publishedAt: string | null }>
  >();
  for (const v of rows) {
    if (!v.source_id) continue;
    const list = peersBySource.get(v.source_id) ?? [];
    list.push({
      id: v.id,
      views: latestByVideo.get(v.id)?.views ?? null,
      publishedAt: v.published_at,
    });
    peersBySource.set(v.source_id, list);
  }
  for (const list of peersBySource.values()) {
    list.sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    );
  }

  return rows.map((v) => {
    const metrics = latestByVideo.get(v.id) ?? null;
    const peers = v.source_id
      ? (peersBySource.get(v.source_id) ?? [])
          .filter((p) => p.id !== v.id)
          .map((p) => p.views)
      : [];
    const source = v.source_id ? sourceById.get(v.source_id) : undefined;
    return {
      ...v,
      metrics,
      engagement: metrics
        ? engagementRate({
            views: metrics.views,
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
            saves: metrics.saves,
          })
        : null,
      outlier: v.source_id ? outlierScore(metrics?.views ?? null, peers) : null,
      sourceHandle: source?.handle ?? null,
      sourceTags: source?.tags ?? [],
      hasAnalysis: analyzed.has(v.id),
    };
  });
}
