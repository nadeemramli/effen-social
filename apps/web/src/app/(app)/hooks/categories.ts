/** Shared hook-library constants and types (imported by both server and client code). */

export const HOOK_CATEGORIES = [
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
] as const;

export type HookCategory = (typeof HOOK_CATEGORIES)[number];

export const HOOK_CATEGORY_LABELS: Record<HookCategory, string> = {
  curiosity_gap: "Curiosity gap",
  bold_claim: "Bold claim",
  question: "Question",
  pattern_interrupt: "Pattern interrupt",
  story_open: "Story open",
  relatable_pain: "Relatable pain",
  contrarian: "Contrarian",
  list_promise: "List promise",
  demonstration: "Demonstration",
  other: "Other",
};

export function hookCategoryLabel(category: string): string {
  return HOOK_CATEGORY_LABELS[category as HookCategory] ?? category;
}

export interface HookItem {
  id: string;
  mechanism: string;
  category: string;
  example: string | null;
  notes: string;
  createdAt: string;
  /** Present when source_analysis_id resolves to a video in this workspace. */
  sourceVideo: { id: string; title: string | null } | null;
}
