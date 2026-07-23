import { hostname } from "node:os";
import { backoffSeconds, type JobPayload } from "@effen/core";
import { db, PermanentJobError, setVideoError, transition } from "./db";
import { env } from "./env";
import {
  handleAcquireMedia,
  handleAnalyze,
  handleGenerateIdeas,
  handleNormalizeMedia,
  handleRetentionCleanup,
  handleTranscribe,
} from "./handlers";

/**
 * EFFEN media worker. Polls the durable Postgres job queue (dev/default mode);
 * in production the same handlers can be fronted by a QStash-verified HTTP
 * endpoint. Every handler is idempotent: replays skip completed work.
 */

const WORKER_ID = `${hostname()}:${process.pid}`;

const HANDLERS: Record<string, (payload: JobPayload) => Promise<void>> = {
  acquire_media: handleAcquireMedia,
  normalize_media: handleNormalizeMedia,
  transcribe: handleTranscribe,
  analyze: handleAnalyze,
  generate_ideas: handleGenerateIdeas,
  retention_cleanup: handleRetentionCleanup,
};

interface JobRow {
  id: string;
  type: string;
  payload: JobPayload;
  attempts: number;
  max_attempts: number;
  workspace_id: string;
}

async function completeJob(
  id: string,
  status: "succeeded" | "failed" | "dead",
  lastError?: string,
) {
  await db
    .from("jobs")
    .update({
      status,
      last_error: lastError ?? null,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", id);
}

async function retryJob(job: JobRow, message: string) {
  const delay = backoffSeconds(job.attempts);
  await db
    .from("jobs")
    .update({
      status: "pending",
      last_error: message,
      run_after: new Date(Date.now() + delay * 1000).toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", job.id);
  console.warn(
    `[worker] job ${job.type}/${job.id} attempt ${job.attempts} failed, retrying in ${delay}s: ${message}`,
  );
}

async function markVideoFailed(
  job: JobRow,
  message: string,
  permanent: boolean,
) {
  const videoId = job.payload.videoId;
  if (!videoId) return;
  try {
    await transition(
      videoId,
      job.workspace_id,
      permanent ? "failed_permanent" : "failed_retryable",
      message,
    );
    await setVideoError(videoId, job.workspace_id, message);
  } catch {
    /* video may be in a state that can't transition; leave as-is */
  }
}

async function processOne(): Promise<boolean> {
  const { data, error } = await db.rpc("claim_job", { worker_id: WORKER_ID });
  if (error) {
    console.error(`[worker] claim_job failed: ${error.message}`);
    return false;
  }
  const job = (Array.isArray(data) ? data[0] : data) as JobRow | undefined;
  if (!job) return false;

  const handler = HANDLERS[job.type];
  console.log(
    `[worker] ${job.type} ${job.id} (attempt ${job.attempts}/${job.max_attempts})`,
  );
  if (!handler) {
    await completeJob(job.id, "dead", `No handler for job type ${job.type}`);
    return true;
  }

  try {
    await handler(job.payload);
    await completeJob(job.id, "succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError;
    if (permanent) {
      await completeJob(job.id, "dead", message);
      await markVideoFailed(job, message, true);
    } else if (job.attempts >= job.max_attempts) {
      await completeJob(job.id, "failed", message);
      await markVideoFailed(
        job,
        `${message} (after ${job.attempts} attempts)`,
        false,
      );
    } else {
      await retryJob(job, message);
    }
  }
  return true;
}

let shuttingDown = false;
process.on("SIGINT", () => (shuttingDown = true));
process.on("SIGTERM", () => (shuttingDown = true));

console.log(
  `[worker] ${WORKER_ID} started — mode=${env.EFFEN_MODE} storage=${env.EFFEN_STORAGE} poll=${env.WORKER_POLL_INTERVAL_MS}ms`,
);

for (;;) {
  if (shuttingDown) {
    console.log("[worker] shutting down");
    process.exit(0);
  }
  try {
    const worked = await processOne();
    if (!worked)
      await new Promise((r) => setTimeout(r, env.WORKER_POLL_INTERVAL_MS));
  } catch (err) {
    console.error("[worker] loop error:", err);
    await new Promise((r) => setTimeout(r, env.WORKER_POLL_INTERVAL_MS * 2));
  }
}
