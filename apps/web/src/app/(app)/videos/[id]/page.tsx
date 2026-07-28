import Link from "next/link";
import { notFound } from "next/navigation";
import {
  analysisV1Schema,
  type AnalysisV1,
  type PipelineStatus,
} from "@effen/core";
import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { storage } from "@/lib/adapters/storage";
import { VideoDetail } from "./detail";

export const metadata = { title: "Video — EFFEN Studio" };

export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: video } = await supabase
    .from("videos")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!video) notFound();

  const [
    { data: assets },
    { data: analyses },
    { data: notes },
    { data: events },
    { data: snapshots },
    { data: ideas },
  ] = await Promise.all([
    supabase
      .from("media_assets")
      .select("*")
      .eq("video_id", id)
      .order("created_at"),
    supabase
      .from("analyses")
      .select("*")
      .eq("video_id", id)
      .order("version", { ascending: false }),
    supabase
      .from("analysis_notes")
      .select("content, updated_at")
      .eq("video_id", id)
      .maybeSingle(),
    supabase
      .from("pipeline_events")
      .select("from_status, to_status, detail, created_at")
      .eq("video_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("video_metrics_snapshots")
      .select("views, likes, comments, shares, saves, captured_at")
      .eq("video_id", id)
      .order("captured_at", { ascending: false })
      .limit(10),
    supabase.from("ideas").select("id, title, status").eq("video_id", id),
  ]);

  // Playback: proxy if normalized, otherwise the uploaded original; embeds for platforms.
  const proxy = assets?.find((a) => a.kind === "proxy");
  const original = assets?.find((a) => a.kind === "original");
  const poster = assets?.find((a) => a.kind === "poster");
  const playable = proxy ?? original;
  const [mediaUrl, posterUrl, frames] = await Promise.all([
    playable
      ? storage().createSignedReadUrl(playable.storage_key, {
          expiresInSeconds: 3600,
        })
      : null,
    poster
      ? storage().createSignedReadUrl(poster.storage_key, {
          expiresInSeconds: 3600,
        })
      : null,
    Promise.all(
      (assets ?? [])
        .filter((a) => a.kind === "frame")
        .slice(0, 8)
        .map(async (a) => ({
          url: await storage().createSignedReadUrl(a.storage_key, {
            expiresInSeconds: 3600,
          }),
          timeSeconds: Number(a.frame_time_seconds ?? 0),
        })),
    ),
  ]);

  const parsedAnalyses = (analyses ?? []).flatMap((a) => {
    const parsed = analysisV1Schema.safeParse(a.content);
    return parsed.success
      ? [
          {
            id: a.id as string,
            version: a.version as number,
            createdAt: a.created_at as string,
            provider: a.provider as string,
            model: a.model as string,
            content: parsed.data satisfies AnalysisV1,
          },
        ]
      : [];
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={back && back.startsWith("/videos") ? back : "/videos"}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Back to library
      </Link>
      <VideoDetail
        video={{
          id: video.id,
          title: video.title,
          caption: video.caption,
          platform: video.platform,
          origin: video.origin,
          status: video.status as PipelineStatus,
          statusDetail: video.status_detail,
          lastError: video.last_error,
          canonicalUrl: video.canonical_url,
          embedUrl: video.playback_embed_url,
          durationSeconds:
            video.duration_seconds != null
              ? Number(video.duration_seconds)
              : null,
          publishedAt: video.published_at,
          checksum: video.media_checksum,
        }}
        mediaUrl={mediaUrl}
        posterUrl={posterUrl}
        frames={frames}
        analyses={parsedAnalyses}
        notes={notes?.content ?? ""}
        events={
          (events ?? []) as Array<{
            from_status: string | null;
            to_status: string;
            detail: string | null;
            created_at: string;
          }>
        }
        snapshots={(snapshots ?? []).map((s) => ({
          ...s,
          captured_at: s.captured_at as string,
        }))}
        ideas={
          (ideas ?? []) as Array<{ id: string; title: string; status: string }>
        }
      />
    </div>
  );
}
