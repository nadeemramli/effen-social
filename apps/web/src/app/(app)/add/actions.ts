"use server";

import { revalidatePath } from "next/cache";
import { classifyUrl, MEDIA_LIMITS, ProviderError } from "@effen/core";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { providerFor } from "@/lib/providers/registry";
import { storage } from "@/lib/adapters/storage";
import { transitionVideo } from "@/lib/videos";

export interface AddUrlResult {
  ok: boolean;
  videoId?: string;
  duplicate?: boolean;
  error?: string;
  errorKind?: string;
}

export async function addVideoByUrl(rawUrl: string): Promise<AddUrlResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const classified = classifyUrl(rawUrl);
  if (!classified) {
    return {
      ok: false,
      error:
        "That doesn't look like a YouTube, Instagram, or TikTok link. Paste the full video URL.",
      errorKind: "unsupported_url",
    };
  }
  if (classified.kind !== "video") {
    return {
      ok: false,
      error:
        "That's a creator profile link. Add it on the Sources page to watch a creator.",
      errorKind: "unsupported_url",
    };
  }

  // Duplicate prevention by platform + external id.
  const { data: existing } = await supabase
    .from("videos")
    .select("id")
    .eq("workspace_id", ws.workspaceId)
    .eq("platform", classified.platform)
    .eq("external_id", classified.externalId)
    .maybeSingle();
  if (existing) return { ok: true, videoId: existing.id, duplicate: true };

  const { data: created, error: insertError } = await supabase
    .from("videos")
    .insert({
      workspace_id: ws.workspaceId,
      platform: classified.platform,
      origin: "url",
      external_id: classified.externalId,
      canonical_url: classified.canonicalUrl,
      status: "created",
    })
    .select("id")
    .single();
  if (insertError || !created) {
    if (insertError?.code === "23505") return { ok: true, duplicate: true };
    return {
      ok: false,
      error: insertError?.message ?? "Could not save the video.",
    };
  }
  const videoId = created.id as string;

  try {
    await transitionVideo(
      videoId,
      ws.workspaceId,
      "discovering",
      "Fetching metadata",
    );
    const provider = await providerFor(classified.platform, ws.workspaceId);
    const resolved = await provider.resolveUrl(classified.canonicalUrl);
    const { video, raw } = await provider.fetchVideoMetadata(resolved);

    // Upsert the creator as a source so outlier scoring has a home.
    let sourceId: string | null = null;
    if (video.creator) {
      const { data: source } = await supabase
        .from("sources")
        .upsert(
          {
            workspace_id: ws.workspaceId,
            platform: video.creator.platform,
            external_id: video.creator.externalId,
            handle: video.creator.handle,
            display_name: video.creator.displayName,
            avatar_url: video.creator.avatarUrl,
            follower_count: video.creator.followerCount,
            profile_url: video.creator.profileUrl,
          },
          { onConflict: "workspace_id,platform,external_id" },
        )
        .select("id")
        .single();
      sourceId = source?.id ?? null;
    }

    await supabase
      .from("videos")
      .update({
        source_id: sourceId,
        title: video.title,
        caption: video.caption,
        published_at: video.publishedAt,
        duration_seconds: video.durationSeconds,
        thumbnail_url: video.thumbnailUrl,
        hashtags: video.hashtags,
        language: video.language,
        playback_embed_url:
          video.playback.kind === "embed" ? video.playback.embedUrl : null,
      })
      .eq("id", videoId)
      .eq("workspace_id", ws.workspaceId);

    await supabase.from("video_metrics_snapshots").insert({
      video_id: videoId,
      workspace_id: ws.workspaceId,
      views: video.metrics.views,
      likes: video.metrics.likes,
      comments: video.metrics.comments,
      shares: video.metrics.shares,
      saves: video.metrics.saves,
      captured_at: video.metrics.capturedAt,
    });

    await supabase.from("raw_provider_payloads").insert({
      workspace_id: ws.workspaceId,
      provider: provider.id,
      ref_type: "video",
      ref_id: videoId,
      payload: raw ?? {},
    });

    await transitionVideo(
      videoId,
      ws.workspaceId,
      "metadata_ready",
      "Metadata collected",
    );
    revalidatePath("/videos");
    return { ok: true, videoId };
  } catch (err) {
    const message =
      err instanceof ProviderError ? err.message : "Metadata fetch failed.";
    const kind = err instanceof ProviderError ? err.kind : "unknown";
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const target =
      kind === "not_found" || kind === "private"
        ? "media_unavailable"
        : kind === "policy"
          ? "policy_blocked"
          : retryable
            ? "failed_retryable"
            : "failed_permanent";
    try {
      await transitionVideo(videoId, ws.workspaceId, target as never, message);
      await supabase
        .from("videos")
        .update({ last_error: message })
        .eq("id", videoId)
        .eq("workspace_id", ws.workspaceId);
    } catch {
      /* keep original error */
    }
    revalidatePath("/videos");
    return { ok: false, videoId, error: message, errorKind: kind };
  }
}

export interface UploadTargetResult {
  ok: boolean;
  error?: string;
  videoId?: string;
  url?: string;
  headers?: Record<string, string>;
  key?: string;
}

export async function createUploadTarget(
  fileName: string,
  contentType: string,
  sizeBytes: number,
): Promise<UploadTargetResult> {
  const ws = await requireWorkspace();

  if (
    !(MEDIA_LIMITS.allowedUploadMimeTypes as readonly string[]).includes(
      contentType,
    )
  ) {
    return {
      ok: false,
      error: `Unsupported file type ${contentType}. Use MP4, MOV, or WebM.`,
    };
  }
  if (sizeBytes <= 0 || sizeBytes > MEDIA_LIMITS.maxUploadBytes) {
    return {
      ok: false,
      error: `File must be under ${Math.round(MEDIA_LIMITS.maxUploadBytes / 1024 / 1024)} MB.`,
    };
  }

  const supabase = await supabaseServer();
  const { data: created, error } = await supabase
    .from("videos")
    .insert({
      workspace_id: ws.workspaceId,
      platform: "upload",
      origin: "upload",
      title: fileName.replace(/\.[^.]+$/, ""),
      upload_file_name: fileName,
      status: "created",
      status_detail: "Awaiting upload",
    })
    .select("id")
    .single();
  if (error || !created)
    return {
      ok: false,
      error: error?.message ?? "Could not create the video record.",
    };

  const target = await storage().createSignedUpload({
    workspaceId: ws.workspaceId,
    kind: "original",
    fileName,
    contentType,
    maxBytes: MEDIA_LIMITS.maxUploadBytes,
  });
  return {
    ok: true,
    videoId: created.id,
    url: target.url,
    headers: target.headers,
    key: target.key,
  };
}

export async function finalizeUpload(
  videoId: string,
  key: string,
  contentType: string,
  sizeBytes: number,
): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: video } = await supabase
    .from("videos")
    .select("id, status, workspace_id")
    .eq("id", videoId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!video) return { ok: false, error: "Upload record not found." };
  if (!key.startsWith(`${ws.workspaceId}/`))
    return {
      ok: false,
      error: "Storage key does not belong to this workspace.",
    };

  if (!(await storage().objectExists(key))) {
    return {
      ok: false,
      error:
        "The uploaded file was not found in storage. Try the upload again.",
    };
  }

  await supabase.from("media_assets").insert({
    video_id: videoId,
    workspace_id: ws.workspaceId,
    kind: "original",
    storage_key: key,
    content_type: contentType,
    bytes: sizeBytes,
  });
  await transitionVideo(
    videoId,
    ws.workspaceId,
    "metadata_ready",
    "Upload received — ready to analyze",
  );
  await writeAudit(ws.workspaceId, ws.userId, "video.upload", {
    videoId,
    bytes: sizeBytes,
  });
  revalidatePath("/videos");
  return { ok: true };
}
