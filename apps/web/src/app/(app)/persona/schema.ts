import { z } from "zod";

/** Shape stored in persona_versions.content (jsonb). */
export interface PersonaContent {
  audience: string;
  voice: string;
  pillars: string[];
  goals: string;
  boundaries: string;
  sampleTopics: string[];
}

const stringList = z
  .array(z.string())
  .default([])
  .transform((items) => items.map((s) => s.trim()).filter((s) => s.length > 0));

export const personaInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give this persona a name.")
    .max(120, "Keep the name under 120 characters."),
  audience: z
    .string()
    .trim()
    .min(1, "Describe who this persona speaks to — it anchors idea relevance."),
  voice: z.string().trim().max(4000).default(""),
  pillars: stringList,
  goals: z.string().trim().max(4000).default(""),
  boundaries: z.string().trim().max(4000).default(""),
  sampleTopics: stringList,
});

export type PersonaInput = z.input<typeof personaInputSchema>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** Defensive read of a jsonb content blob into the canonical shape (stable key order). */
export function parsePersonaContent(json: unknown): PersonaContent {
  const obj = (json ?? {}) as Record<string, unknown>;
  return {
    audience: str(obj.audience),
    voice: str(obj.voice),
    pillars: strArray(obj.pillars),
    goals: str(obj.goals),
    boundaries: str(obj.boundaries),
    sampleTopics: strArray(obj.sampleTopics),
  };
}
