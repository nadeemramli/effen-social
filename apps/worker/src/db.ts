import { createClient } from "@supabase/supabase-js";
import { assertTransition, type PipelineStatus } from "@effen/core";
import { env } from "./env";

/** Service-role client — the worker bypasses RLS but always scopes by ids from job payloads. */
export const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

export async function getVideo(videoId: string, workspaceId: string) {
  const { data, error } = await db
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`video load failed: ${error.message}`);
  if (!data) throw new PermanentJobError("Video not found (deleted?)");
  return data;
}

export async function transition(
  videoId: string,
  workspaceId: string,
  to: PipelineStatus,
  detail?: string,
): Promise<void> {
  const video = await getVideo(videoId, workspaceId);
  const from = video.status as PipelineStatus;
  if (from === to) return; // idempotent replays
  if (from === "cancelled") throw new PermanentJobError("Video was cancelled");
  assertTransition(from, to);
  const { error } = await db
    .from("videos")
    .update({ status: to, status_detail: detail ?? null })
    .eq("id", videoId)
    .eq("workspace_id", workspaceId)
    .eq("status", from);
  if (error) throw new Error(error.message);
  await db.from("pipeline_events").insert({
    video_id: videoId,
    workspace_id: workspaceId,
    from_status: from,
    to_status: to,
    detail: detail ?? null,
  });
}

export async function setVideoError(
  videoId: string,
  workspaceId: string,
  message: string,
) {
  await db
    .from("videos")
    .update({ last_error: message })
    .eq("id", videoId)
    .eq("workspace_id", workspaceId);
}

/** Thrown when a job must not be retried (bad input, policy, deleted rows). */
export class PermanentJobError extends Error {
  permanent = true as const;
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const { error } = await db.from("jobs").insert({
    workspace_id: payload.workspaceId,
    type,
    payload,
    idempotency_key: idempotencyKey,
  });
  if (error && error.code !== "23505")
    throw new Error(`enqueue ${type} failed: ${error.message}`);
}
