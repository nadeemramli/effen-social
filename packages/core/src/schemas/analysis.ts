import { z } from "zod";

/**
 * Structured video-analysis output, version 1.
 * Every AI adapter must return data validating against this schema. Unknown or
 * unverifiable facts must be null / flagged uncertain — never invented.
 * Timestamps are seconds from video start so the UI can seek the player.
 */

export const ANALYSIS_SCHEMA_VERSION = 1;

const timestamp = z.number().min(0);

export const confidenceSchema = z.enum(["high", "medium", "low"]);

export const transcriptSegmentSchema = z.object({
  start: timestamp,
  end: timestamp,
  text: z.string(),
  speaker: z.string().nullable(),
});

export const onScreenTextSchema = z.object({
  start: timestamp,
  end: timestamp.nullable(),
  text: z.string(),
  role: z.enum(["hook", "caption", "cta", "label", "other"]),
});

export const hookAnalysisSchema = z.object({
  /** The mechanism, described abstractly (reusable), not the source wording. */
  mechanism: z.string(),
  category: z.enum([
    "curiosity_gap",
    "bold_claim",
    "question",
    "pattern_interrupt",
    "story_open",
    "relatable_pain",
    "contrarian",
    "list_promise",
    "demonstration",
    "other",
  ]),
  /** Verbatim opening line from the transcript — source evidence, never for reuse. */
  sourceQuote: z.string().nullable(),
  windowSeconds: z.number().min(0).nullable(),
  whyItWorks: z.string(),
  confidence: confidenceSchema,
});

export const storyBeatSchema = z.object({
  start: timestamp,
  end: timestamp.nullable(),
  beat: z.string(), // e.g. "Problem setup", "Escalation", "Payoff"
  description: z.string(),
});

export const visualPatternSchema = z.object({
  pattern: z.string(), // e.g. "Talking head with center framing"
  timestamps: z.array(timestamp),
  notes: z.string().nullable(),
});

export const ideaCandidateSchema = z.object({
  title: z.string(),
  angle: z.string(),
  /** Why this is an adaptation for the persona, not an imitation of the source. */
  originalityRationale: z.string(),
  personaRelevance: z.string(),
  storytellingFormat: z.enum([
    "listicle",
    "tutorial",
    "story",
    "hot_take",
    "case_study",
    "myth_bust",
    "comparison",
    "behind_scenes",
    "other",
  ]),
  /** Evidence pointers back into this analysis (timestamps / metric references). */
  evidence: z.array(z.string()),
  copyingRisk: z.enum(["low", "medium", "high"]),
  copyingRiskNote: z.string().nullable(),
});

export const analysisV1Schema = z.object({
  schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
  summary: z.string(),
  targetAudience: z.string(),
  topic: z.string(),
  primaryMessage: z.string(),
  transcript: z.array(transcriptSegmentSchema),
  transcriptSource: z.enum([
    "dedicated_stt",
    "video_model",
    "platform_captions",
    "unavailable",
  ]),
  onScreenText: z.array(onScreenTextSchema),
  hook: hookAnalysisSchema,
  beats: z.array(storyBeatSchema),
  visualPatterns: z.array(visualPatternSchema),
  editingNotes: z.string().nullable(),
  /**
   * Performance interpretation grounded in stored metrics; must reference real
   * numbers passed in as context, never invented ones.
   */
  performanceContext: z.object({
    interpretation: z.string(),
    referencedMetrics: z.array(z.string()),
    confidence: confidenceSchema,
  }),
  uncertainties: z.array(z.string()),
  overallConfidence: confidenceSchema,
  ideaCandidates: z.array(ideaCandidateSchema),
  copyingRiskWarnings: z.array(z.string()),
  safetyFlags: z.array(z.string()),
});

export type AnalysisV1 = z.infer<typeof analysisV1Schema>;
export type IdeaCandidate = z.infer<typeof ideaCandidateSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
