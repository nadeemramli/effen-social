import type { PipelineStatus } from "../domain/pipeline";

/**
 * Durable job dispatch. Dev: Postgres-backed queue polled by the worker.
 * Prod: QStash pushes signed webhooks to the worker. Both share this contract.
 * Long-running media/AI work NEVER runs inside a web request.
 */

export const JOB_TYPES = [
  "discover_source", // fetch creator's recent videos (metadata only)
  "fetch_metadata", // metadata for a single video
  "acquire_media", // SSRF-safe download or copy of uploaded original
  "normalize_media", // ffmpeg validation, proxy, audio, poster, frames, checksum
  "transcribe", // dedicated STT step
  "analyze", // whole-video structured analysis
  "generate_ideas", // idea candidates from a completed analysis
  "refresh_metrics", // metric counts only; no AI
  "wizard_research",
  "wizard_hooks",
  "wizard_script",
  "script_revision",
  "retention_cleanup",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface JobPayload {
  workspaceId: string;
  videoId?: string;
  sourceId?: string;
  scriptId?: string;
  ideaId?: string;
  /** Extra type-specific parameters; validated by each handler. */
  params?: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  type: JobType;
  payload: JobPayload;
  /** Dedupe key: identical pending/running keys are not enqueued twice. */
  idempotencyKey: string;
  status: "pending" | "running" | "succeeded" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError: string | null;
  createdAt: string;
}

export interface JobDispatcher {
  readonly id: "db_queue" | "qstash";
  /** Enqueue; returns existing job id when the idempotency key is already active. */
  enqueue(
    type: JobType,
    payload: JobPayload,
    opts?: {
      idempotencyKey?: string;
      delaySeconds?: number;
      maxAttempts?: number;
    },
  ): Promise<{ jobId: string; deduped: boolean }>;
}

export function backoffSeconds(attempt: number): number {
  // 30s, 2m, 8m, 30m, capped — no retry loop may grow unbounded.
  return Math.min(30 * 4 ** (attempt - 1), 1800);
}

/** Map job types to the pipeline status they drive, for progress display. */
export const JOB_ACTIVE_STATUS: Partial<Record<JobType, PipelineStatus>> = {
  discover_source: "discovering",
  fetch_metadata: "discovering",
  acquire_media: "acquiring_media",
  normalize_media: "normalizing",
  transcribe: "transcribing",
  analyze: "analyzing",
  generate_ideas: "generating_ideas",
};
