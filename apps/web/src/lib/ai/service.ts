import "server-only";
import {
  estimateOperationUsd,
  resolveRoute,
  type AiOperation,
} from "@effen/core";
import { env, isMockMode } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export const PROMPT_VERSIONS: Record<string, string> = {
  analysis: "analysis.v1",
  idea_generation: "ideas.v1",
  research: "research.v1",
  hook_generation: "hooks.v1",
  script_writing: "script.v1",
  script_revision: "script-revision.v1",
};

interface LedgerEntry {
  workspaceId: string;
  operation: AiOperation;
  promptTemplate: string;
  outputSchemaVersion: number;
  personaVersion?: number | null;
  sourceAnalysisVersion?: number | null;
  videoId?: string | null;
  scriptId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  mediaSeconds?: number;
  /** OpenRouter's per-response usage.cost — actual billed amount in USD credits. */
  reportedCostUsd?: number | null;
  /** Actual model that served the request (may differ from the routed slug). */
  servedModel?: string | null;
  latencyMs: number;
  status: "succeeded" | "failed";
  error?: string | null;
  safetyFlags?: string[];
}

/**
 * Record every AI operation in the usage ledger, mock or live. Estimated cost
 * comes from the routing price table; reported cost comes from OpenRouter's
 * usage accounting when available and takes precedence in spend tracking.
 */
export async function recordAiRun(entry: LedgerEntry): Promise<number> {
  const route = resolveRoute(
    entry.operation,
    process.env as Record<string, string | undefined>,
    isMockMode(),
  );
  const estimated = isMockMode()
    ? 0
    : estimateOperationUsd(route, {
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        mediaMinutes: (entry.mediaSeconds ?? 0) / 60,
      });
  const supabase = await supabaseServer();
  const { error } = await supabase.from("ai_runs").insert({
    workspace_id: entry.workspaceId,
    operation: entry.operation,
    provider: route.provider,
    model: entry.servedModel ?? route.model,
    prompt_template: entry.promptTemplate,
    prompt_version:
      PROMPT_VERSIONS[entry.promptTemplate.split(".")[0] ?? ""] ??
      entry.promptTemplate,
    output_schema_version: entry.outputSchemaVersion,
    persona_version: entry.personaVersion ?? null,
    source_analysis_version: entry.sourceAnalysisVersion ?? null,
    input_tokens: entry.inputTokens ?? null,
    output_tokens: entry.outputTokens ?? null,
    media_seconds: entry.mediaSeconds ?? null,
    estimated_cost_usd: estimated,
    reported_cost_usd: entry.reportedCostUsd ?? null,
    latency_ms: entry.latencyMs,
    status: entry.status,
    error: entry.error ?? null,
    safety_flags: entry.safetyFlags ?? [],
    video_id: entry.videoId ?? null,
    script_id: entry.scriptId ?? null,
  });
  if (error) console.error("[ai-ledger] failed to record run:", error.message);
  return estimated;
}

/** Rough token estimate for cost previews (4 chars/token heuristic). */
export function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimated USD for one full deep analysis of a video (pre-run preview).
 * Uses live-mode pricing even in mock mode so budget caps stay exercisable;
 * the ledger still records $0 actual spend for mock runs.
 */
export function estimateAnalysisUsd(durationSeconds: number): number {
  const e = process.env as Record<string, string | undefined>;
  const video = resolveRoute("video_understanding", e, false);
  const stt = resolveRoute("transcription", e, false);
  const ideas = resolveRoute("idea_generation", e, false);
  const minutes = durationSeconds / 60;
  return (
    estimateOperationUsd(video, {
      inputTokens: Math.round(minutes * 12_000),
      outputTokens: 4_000,
    }) +
    estimateOperationUsd(stt, { mediaMinutes: minutes }) +
    estimateOperationUsd(ideas, { inputTokens: 6_000, outputTokens: 2_000 })
  );
}

export function currentMode(): "mock" | "live" {
  return env().EFFEN_MODE;
}
