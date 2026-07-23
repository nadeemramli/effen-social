import { z } from "zod";

export const SCRIPT_SCHEMA_VERSION = 1;
export const RESEARCH_SCHEMA_VERSION = 1;
export const HOOKS_SCHEMA_VERSION = 1;

export const SCRIPT_STATUSES = [
  "draft",
  "revising",
  "ready",
  "recorded",
  "archived",
] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

/** Words-per-minute used for spoken-duration estimates (conversational pace). */
export const SPOKEN_WPM = 150;

export function estimateSpokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / SPOKEN_WPM) * 60);
}

/* ------------------------------------------------------------ wizard: research */

export const researchFindingSchema = z.object({
  claim: z.string(),
  support: z.string(),
  /** null when the model cannot ground the claim — surfaces as "needs verification". */
  source: z.string().nullable(),
  needsVerification: z.boolean(),
});

export const researchV1Schema = z.object({
  schemaVersion: z.literal(RESEARCH_SCHEMA_VERSION),
  angleSummary: z.string(),
  findings: z.array(researchFindingSchema),
  audienceQuestions: z.array(z.string()),
  contrarianTakes: z.array(z.string()),
  gaps: z.array(z.string()),
});
export type ResearchV1 = z.infer<typeof researchV1Schema>;

/* --------------------------------------------------------------- wizard: hooks */

export const hookOptionSchema = z.object({
  text: z.string(),
  mechanism: z.string(),
  category: z.string(),
  rationale: z.string(),
});

export const hooksV1Schema = z.object({
  schemaVersion: z.literal(HOOKS_SCHEMA_VERSION),
  options: z.array(hookOptionSchema).min(1),
});
export type HooksV1 = z.infer<typeof hooksV1Schema>;

/* -------------------------------------------------------------- wizard: script */

export const SCRIPT_SECTION_KINDS = ["hook", "setup", "body", "cta"] as const;

export const scriptSectionSchema = z.object({
  id: z.string(), // stable across regenerations so one section can be replaced
  kind: z.enum(SCRIPT_SECTION_KINDS),
  heading: z.string(),
  content: z.string(),
});

export const scriptV1Schema = z.object({
  schemaVersion: z.literal(SCRIPT_SCHEMA_VERSION),
  title: z.string(),
  sections: z.array(scriptSectionSchema).min(1),
  claimsToVerify: z.array(z.string()),
  deliveryNotes: z.string().nullable(),
});
export type ScriptV1 = z.infer<typeof scriptV1Schema>;
export type ScriptSection = z.infer<typeof scriptSectionSchema>;

export function scriptPlainText(s: ScriptV1): string {
  return s.sections
    .map((sec) => `${sec.heading.toUpperCase()}\n\n${sec.content}`)
    .join("\n\n");
}

export function scriptMarkdown(s: ScriptV1): string {
  const body = s.sections
    .map((sec) => `## ${sec.heading}\n\n${sec.content}`)
    .join("\n\n");
  const claims = s.claimsToVerify.length
    ? `\n\n---\n\n### Claims to verify\n\n${s.claimsToVerify.map((c) => `- [ ] ${c}`).join("\n")}`
    : "";
  return `# ${s.title}\n\n${body}${claims}\n`;
}

export function scriptFullText(s: ScriptV1): string {
  return s.sections.map((sec) => sec.content).join("\n\n");
}
