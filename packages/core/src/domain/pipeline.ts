/**
 * Video processing pipeline state machine.
 * Every transition must go through `canTransition`/`assertTransition` so that
 * illegal jumps (e.g. metadata_ready -> analyzing) are impossible to persist.
 */

export const PIPELINE_STATUSES = [
  "created",
  "discovering",
  "metadata_ready",
  "selected_for_analysis",
  "acquiring_media",
  "normalizing",
  "transcribing",
  "analyzing",
  "generating_ideas",
  "complete",
  "cancelled",
  "failed_retryable",
  "failed_permanent",
  "media_unavailable",
  "budget_blocked",
  "policy_blocked",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Statuses that represent in-flight work. */
export const ACTIVE_STATUSES: readonly PipelineStatus[] = [
  "discovering",
  "acquiring_media",
  "normalizing",
  "transcribing",
  "analyzing",
  "generating_ideas",
];

/** Statuses from which a user-initiated retry is allowed. */
export const RETRYABLE_STATUSES: readonly PipelineStatus[] = [
  "failed_retryable",
  "budget_blocked",
  "media_unavailable",
];

/** Terminal statuses that no automatic process may leave. */
export const TERMINAL_STATUSES: readonly PipelineStatus[] = [
  "complete",
  "cancelled",
  "failed_permanent",
  "policy_blocked",
];

const HAPPY_PATH: PipelineStatus[] = [
  "created",
  "discovering",
  "metadata_ready",
  "selected_for_analysis",
  "acquiring_media",
  "normalizing",
  "transcribing",
  "analyzing",
  "generating_ideas",
  "complete",
];

const TRANSITIONS: Record<PipelineStatus, readonly PipelineStatus[]> = {
  created: [
    "discovering",
    "metadata_ready",
    "cancelled",
    "failed_retryable",
    "failed_permanent",
  ],
  discovering: [
    "metadata_ready",
    "media_unavailable",
    "failed_retryable",
    "failed_permanent",
    "policy_blocked",
    "cancelled",
  ],
  metadata_ready: ["selected_for_analysis", "discovering", "cancelled"],
  selected_for_analysis: [
    "acquiring_media",
    "budget_blocked",
    "metadata_ready",
    "cancelled",
    "failed_retryable",
  ],
  acquiring_media: [
    "normalizing",
    "media_unavailable",
    "failed_retryable",
    "failed_permanent",
    "policy_blocked",
    "budget_blocked",
    "cancelled",
  ],
  normalizing: [
    "transcribing",
    "failed_retryable",
    "failed_permanent",
    "policy_blocked",
    "cancelled",
  ],
  transcribing: [
    "analyzing",
    "failed_retryable",
    "failed_permanent",
    "budget_blocked",
    "cancelled",
  ],
  analyzing: [
    "generating_ideas",
    "complete",
    "failed_retryable",
    "failed_permanent",
    "budget_blocked",
    "cancelled",
  ],
  generating_ideas: [
    "complete",
    "failed_retryable",
    "budget_blocked",
    "cancelled",
  ],
  complete: ["selected_for_analysis"], // re-analysis of an already-complete video
  cancelled: ["selected_for_analysis", "discovering"],
  failed_retryable: [...HAPPY_PATH.slice(1), "failed_permanent", "cancelled"],
  failed_permanent: [],
  media_unavailable: ["acquiring_media", "discovering", "cancelled"],
  budget_blocked: [
    "selected_for_analysis",
    "acquiring_media",
    "transcribing",
    "analyzing",
    "generating_ideas",
    "cancelled",
  ],
  policy_blocked: [],
};

export function canTransition(
  from: PipelineStatus,
  to: PipelineStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export class PipelineTransitionError extends Error {
  constructor(
    public readonly from: PipelineStatus,
    public readonly to: PipelineStatus,
  ) {
    super(`Illegal pipeline transition: ${from} -> ${to}`);
    this.name = "PipelineTransitionError";
  }
}

export function assertTransition(
  from: PipelineStatus,
  to: PipelineStatus,
): void {
  if (!canTransition(from, to)) throw new PipelineTransitionError(from, to);
}

export function isPipelineStatus(value: string): value is PipelineStatus {
  return (PIPELINE_STATUSES as readonly string[]).includes(value);
}

/** Progress fraction for UI progress bars; failure states keep their last position. */
export function pipelineProgress(status: PipelineStatus): number | null {
  const i = HAPPY_PATH.indexOf(status);
  if (i === -1) return null;
  return i / (HAPPY_PATH.length - 1);
}

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  created: "Added",
  discovering: "Fetching metadata",
  metadata_ready: "Ready to analyze",
  selected_for_analysis: "Queued for analysis",
  acquiring_media: "Acquiring media",
  normalizing: "Normalizing media",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  generating_ideas: "Generating ideas",
  complete: "Analyzed",
  cancelled: "Cancelled",
  failed_retryable: "Failed — retry available",
  failed_permanent: "Failed",
  media_unavailable: "Media unavailable",
  budget_blocked: "Blocked by budget",
  policy_blocked: "Blocked by policy",
};
