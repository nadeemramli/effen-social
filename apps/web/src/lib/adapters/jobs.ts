import "server-only";
import type { JobDispatcher, JobPayload, JobType } from "@effen/core";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Postgres-backed dispatcher (dev + default). Jobs are inserted with the user's
 * session (RLS: members may enqueue for their own workspace only) and processed
 * by the separate worker process using the service role. A unique partial index
 * on active idempotency keys makes double-enqueue impossible.
 */
class DbQueueDispatcher implements JobDispatcher {
  readonly id = "db_queue" as const;

  async enqueue(
    type: JobType,
    payload: JobPayload,
    opts?: {
      idempotencyKey?: string;
      delaySeconds?: number;
      maxAttempts?: number;
    },
  ): Promise<{ jobId: string; deduped: boolean }> {
    const supabase = await supabaseServer();
    const idempotencyKey =
      opts?.idempotencyKey ??
      `${type}:${payload.videoId ?? payload.scriptId ?? payload.sourceId ?? crypto.randomUUID()}`;
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        workspace_id: payload.workspaceId,
        type,
        payload,
        idempotency_key: idempotencyKey,
        max_attempts: opts?.maxAttempts ?? 4,
        run_after: new Date(
          Date.now() + (opts?.delaySeconds ?? 0) * 1000,
        ).toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("jobs")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .in("status", ["pending", "running"])
          .limit(1)
          .maybeSingle();
        return { jobId: existing?.id ?? "unknown", deduped: true };
      }
      throw new Error(`Failed to enqueue ${type}: ${error.message}`);
    }
    return { jobId: data.id, deduped: false };
  }
}

/** QStash dispatcher — production push delivery. Requires QSTASH_TOKEN + WORKER_WEBHOOK_URL. */
class QStashDispatcher implements JobDispatcher {
  readonly id = "qstash" as const;

  async enqueue(
    type: JobType,
    payload: JobPayload,
    opts?: {
      idempotencyKey?: string;
      delaySeconds?: number;
      maxAttempts?: number;
    },
  ): Promise<{ jobId: string; deduped: boolean }> {
    const url = process.env.WORKER_WEBHOOK_URL;
    if (!url)
      throw new Error("WORKER_WEBHOOK_URL is required for qstash dispatch");
    const res = await fetch(
      `https://qstash.upstash.io/v2/publish/${encodeURIComponent(url)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env().QSTASH_TOKEN}`,
          "content-type": "application/json",
          "upstash-retries": String(opts?.maxAttempts ?? 4),
          ...(opts?.delaySeconds
            ? { "upstash-delay": `${opts.delaySeconds}s` }
            : {}),
          ...(opts?.idempotencyKey
            ? { "upstash-deduplication-id": opts.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({ type, payload }),
      },
    );
    if (!res.ok)
      throw new Error(
        `QStash publish failed: ${res.status} ${await res.text()}`,
      );
    const body = (await res.json()) as {
      messageId: string;
      deduplicated?: boolean;
    };
    return { jobId: body.messageId, deduped: body.deduplicated ?? false };
  }
}

let dispatcher: JobDispatcher | null = null;

export function jobs(): JobDispatcher {
  if (!dispatcher) {
    dispatcher =
      env().EFFEN_QUEUE === "qstash"
        ? new QStashDispatcher()
        : new DbQueueDispatcher();
  }
  return dispatcher;
}
