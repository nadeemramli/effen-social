"use server";

import { revalidatePath } from "next/cache";
import {
  classifyUrl,
  ProviderError,
  type NormalizedCreator,
  type NormalizedVideoMetadata,
  type Platform,
} from "@effen/core";
import {
  requireWorkspace,
  writeAudit,
  type WorkspaceContext,
} from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { providerFor } from "@/lib/providers/registry";
import { checkBudget } from "@/lib/budget";

/** Discovery is a cheap metadata pass — never pull more than this per run. */
const DISCOVERY_MAX_ITEMS = 12;

export interface SourceActionResult {
  ok: boolean;
  added?: number;
  skippedDuplicates?: number;
  /** Budget decision detail when the run was blocked before spending anything. */
  blocked?: string;
  error?: string;
  /** ProviderError kind (e.g. "policy" when the provider is disabled in Settings). */
  kind?: string;
}

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;

async function discoveryMaxItems(
  supabase: Supabase,
  workspaceId: string,
): Promise<number> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("per_run_item_cap")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const cap = Number(data?.per_run_item_cap ?? 25);
  return Math.min(DISCOVERY_MAX_ITEMS, cap);
}

/**
 * Persist a discovery result: upsert the source row, insert discovered videos
 * as metadata_ready (skipping duplicates), and snapshot metrics for new rows.
 */
async function persistDiscovery(
  supabase: Supabase,
  workspaceId: string,
  creator: NormalizedCreator,
  videos: NormalizedVideoMetadata[],
  existingSourceId?: string,
): Promise<{
  sourceId: string | null;
  added: number;
  skippedDuplicates: number;
}> {
  let sourceId: string | null = existingSourceId ?? null;
  const creatorFields = {
    handle: creator.handle,
    display_name: creator.displayName,
    avatar_url: creator.avatarUrl,
    follower_count: creator.followerCount,
    profile_url: creator.profileUrl,
    last_discovered_at: new Date().toISOString(),
  };

  if (existingSourceId) {
    // Refresh path: update in place so a provider-side external id drift can't fork the row.
    await supabase
      .from("sources")
      .update(creatorFields)
      .eq("id", existingSourceId)
      .eq("workspace_id", workspaceId);
  } else {
    const { data: source } = await supabase
      .from("sources")
      .upsert(
        {
          workspace_id: workspaceId,
          platform: creator.platform,
          external_id: creator.externalId,
          ...creatorFields,
        },
        { onConflict: "workspace_id,platform,external_id" },
      )
      .select("id")
      .single();
    sourceId = (source?.id as string | undefined) ?? null;
  }

  let added = 0;
  let skippedDuplicates = 0;
  for (const video of videos) {
    const { data: inserted, error } = await supabase
      .from("videos")
      .insert({
        workspace_id: workspaceId,
        source_id: sourceId,
        platform: video.platform,
        origin: "discovery",
        external_id: video.externalId,
        canonical_url: video.canonicalUrl,
        title: video.title,
        caption: video.caption,
        published_at: video.publishedAt,
        duration_seconds: video.durationSeconds,
        thumbnail_url: video.thumbnailUrl,
        hashtags: video.hashtags,
        language: video.language,
        status: "metadata_ready",
        playback_embed_url:
          video.playback.kind === "embed" ? video.playback.embedUrl : null,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      if (error?.code === "23505") skippedDuplicates += 1;
      // Any other insert failure is skipped silently for this row; the run continues.
      continue;
    }
    added += 1;

    await supabase.from("video_metrics_snapshots").insert({
      video_id: inserted.id as string,
      workspace_id: workspaceId,
      views: video.metrics.views,
      likes: video.metrics.likes,
      comments: video.metrics.comments,
      shares: video.metrics.shares,
      saves: video.metrics.saves,
      captured_at: video.metrics.capturedAt,
    });
  }

  return { sourceId, added, skippedDuplicates };
}

/** Budget-checked discovery run shared by addSource and refreshSource. */
async function runDiscovery(
  ws: WorkspaceContext,
  supabase: Supabase,
  platform: Platform,
  creatorRef: { externalId?: string; handle?: string; url?: string },
  existingSourceId?: string,
): Promise<SourceActionResult> {
  const provider = await providerFor(platform, ws.workspaceId);
  const maxItems = await discoveryMaxItems(supabase, ws.workspaceId);

  const estimate = provider.estimateCost("discover", maxItems);
  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd: estimate.estimatedUsd ?? 0,
    itemCount: maxItems,
  });
  if (!decision.allowed) return { ok: false, blocked: decision.detail };

  const { creator, videos } = await provider.discoverCreator(creatorRef, {
    maxItems,
  });
  const { added, skippedDuplicates } = await persistDiscovery(
    supabase,
    ws.workspaceId,
    creator,
    videos,
    existingSourceId,
  );

  revalidatePath("/sources");
  revalidatePath("/videos");
  return { ok: true, added, skippedDuplicates };
}

function providerFailure(err: unknown): SourceActionResult {
  if (err instanceof ProviderError)
    return { ok: false, error: err.message, kind: err.kind };
  return {
    ok: false,
    error: err instanceof Error ? err.message : "Discovery failed.",
  };
}

export async function addSource(url: string): Promise<SourceActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const classified = classifyUrl(url);
  if (!classified) {
    return {
      ok: false,
      error:
        "That doesn't look like a YouTube, TikTok, or Instagram profile link. Paste the creator's profile URL.",
      kind: "unsupported_url",
    };
  }
  if (classified.kind !== "creator") {
    return {
      ok: false,
      error:
        "That's a link to a single video. Use Add video to bring in one video by URL.",
      kind: "unsupported_url",
    };
  }

  try {
    const result = await runDiscovery(ws, supabase, classified.platform, {
      handle: classified.externalId,
      url: classified.canonicalUrl,
    });
    if (result.ok) {
      await writeAudit(ws.workspaceId, ws.userId, "source.add", {
        platform: classified.platform,
        handle: classified.externalId,
        added: result.added,
        skippedDuplicates: result.skippedDuplicates,
      });
    }
    return result;
  } catch (err) {
    return providerFailure(err);
  }
}

export async function refreshSource(
  sourceId: string,
): Promise<SourceActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: source } = await supabase
    .from("sources")
    .select("id, platform, external_id, handle, profile_url")
    .eq("id", sourceId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!source) return { ok: false, error: "Source not found." };

  try {
    const result = await runDiscovery(
      ws,
      supabase,
      source.platform as Platform,
      {
        externalId: source.external_id as string,
        handle: (source.handle as string | null) ?? undefined,
        url: (source.profile_url as string | null) ?? undefined,
      },
      source.id as string,
    );
    if (result.ok) {
      await writeAudit(ws.workspaceId, ws.userId, "source.refresh", {
        sourceId,
        added: result.added,
        skippedDuplicates: result.skippedDuplicates,
      });
    }
    return result;
  } catch (err) {
    return providerFailure(err);
  }
}

export async function updateTags(
  sourceId: string,
  tags: string[],
): Promise<SourceActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(
    0,
    20,
  );
  const { error } = await supabase
    .from("sources")
    .update({ tags: clean })
    .eq("id", sourceId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/sources");
  return { ok: true };
}

export async function toggleSource(
  sourceId: string,
  enabled: boolean,
): Promise<SourceActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("sources")
    .update({ enabled })
    .eq("id", sourceId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(ws.workspaceId, ws.userId, "source.toggle", {
    sourceId,
    enabled,
  });
  revalidatePath("/sources");
  return { ok: true };
}

export async function deleteSource(
  sourceId: string,
): Promise<SourceActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  // videos.source_id is ON DELETE SET NULL — deleting a source never deletes its videos.
  const { error } = await supabase
    .from("sources")
    .delete()
    .eq("id", sourceId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(ws.workspaceId, ws.userId, "source.delete", { sourceId });
  revalidatePath("/sources");
  revalidatePath("/videos");
  return { ok: true };
}
