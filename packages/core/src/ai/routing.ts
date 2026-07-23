/**
 * Configuration-driven model routing. This is the ONLY place model identifiers live.
 * Every entry can be overridden with an environment variable so operators can swap
 * models without a code change. Verify ids against provider docs before enabling
 * real mode; mock mode never contacts a provider.
 */

export type AiOperation =
  | "video_understanding" // whole-video visual+audio analysis
  | "transcription" // dedicated speech-to-text
  | "frame_ocr" // on-screen text extraction / simple frame classification
  | "idea_generation" // high-volume idea drafting + scoring
  | "research" // topic research for the script wizard
  | "hook_generation"
  | "script_writing" // final script drafting/revision
  | "script_revision";

export type AiProviderId = "openai" | "gemini" | "mock";

export interface ModelRoute {
  provider: AiProviderId;
  model: string;
  /** Env var that overrides `model` at runtime. */
  envOverride: string;
  /** USD per 1M tokens (input/output) or per media-minute; used for pre-run estimates. */
  pricing:
    | { kind: "tokens"; inputPerMTokUsd: number; outputPerMTokUsd: number }
    | { kind: "media_minutes"; perMinuteUsd: number };
}

/**
 * Default routing table. Prices are estimation aids, not billing truth — reported
 * provider costs, when available, are stored alongside estimates in the ledger.
 */
export const MODEL_ROUTES: Record<AiOperation, ModelRoute> = {
  video_understanding: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    envOverride: "EFFEN_MODEL_VIDEO_UNDERSTANDING",
    pricing: { kind: "tokens", inputPerMTokUsd: 0.3, outputPerMTokUsd: 2.5 },
  },
  transcription: {
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    envOverride: "EFFEN_MODEL_TRANSCRIPTION",
    pricing: { kind: "media_minutes", perMinuteUsd: 0.003 },
  },
  frame_ocr: {
    provider: "openai",
    model: "gpt-4o-mini",
    envOverride: "EFFEN_MODEL_FRAME_OCR",
    pricing: { kind: "tokens", inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 },
  },
  idea_generation: {
    provider: "openai",
    model: "gpt-5.6-luna",
    envOverride: "EFFEN_MODEL_IDEAS",
    pricing: { kind: "tokens", inputPerMTokUsd: 0.25, outputPerMTokUsd: 2 },
  },
  research: {
    provider: "openai",
    model: "gpt-5.6-luna",
    envOverride: "EFFEN_MODEL_RESEARCH",
    pricing: { kind: "tokens", inputPerMTokUsd: 0.25, outputPerMTokUsd: 2 },
  },
  hook_generation: {
    provider: "openai",
    model: "gpt-5.6-luna",
    envOverride: "EFFEN_MODEL_HOOKS",
    pricing: { kind: "tokens", inputPerMTokUsd: 0.25, outputPerMTokUsd: 2 },
  },
  script_writing: {
    provider: "openai",
    model: "gpt-5.6-terra",
    envOverride: "EFFEN_MODEL_SCRIPT",
    pricing: { kind: "tokens", inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  },
  script_revision: {
    provider: "openai",
    model: "gpt-5.6-terra",
    envOverride: "EFFEN_MODEL_SCRIPT_REVISION",
    pricing: { kind: "tokens", inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  },
};

export function resolveRoute(
  op: AiOperation,
  env: Record<string, string | undefined>,
  mockMode: boolean,
): ModelRoute {
  const base = MODEL_ROUTES[op];
  if (mockMode)
    return { ...base, provider: "mock", model: `mock:${base.model}` };
  const override = env[base.envOverride];
  return override ? { ...base, model: override } : base;
}

export function estimateOperationUsd(
  route: ModelRoute,
  usage: { inputTokens?: number; outputTokens?: number; mediaMinutes?: number },
): number {
  if (route.pricing.kind === "tokens") {
    return (
      ((usage.inputTokens ?? 0) / 1_000_000) * route.pricing.inputPerMTokUsd +
      ((usage.outputTokens ?? 0) / 1_000_000) * route.pricing.outputPerMTokUsd
    );
  }
  return (usage.mediaMinutes ?? 0) * route.pricing.perMinuteUsd;
}
