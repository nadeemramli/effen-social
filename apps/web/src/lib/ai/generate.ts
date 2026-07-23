import "server-only";
import {
  chatStructured,
  hooksV1Schema,
  mockHooks,
  mockRegenerateSection,
  mockResearch,
  mockReviseScript,
  mockScript,
  researchV1Schema,
  resolveRoute,
  scriptV1Schema,
  type AiOperation,
  type HooksV1,
  type ResearchV1,
  type ScriptV1,
} from "@effen/core";
import { env, isMockMode } from "@/lib/env";

/**
 * Mode-aware AI generation for the script workflow. Mock mode uses the
 * deterministic generators; live mode calls OpenRouter with strict structured
 * outputs validated against the same schemas. Callers receive real usage +
 * reported cost so the ledger stays honest either way.
 */

export interface GenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostUsd: number | null;
  servedModel: string | null;
}

const MOCK_USAGE: GenUsage = {
  inputTokens: null,
  outputTokens: null,
  reportedCostUsd: 0,
  servedModel: null,
};

function routeModel(op: AiOperation): string {
  return resolveRoute(
    op,
    process.env as Record<string, string | undefined>,
    false,
  ).model;
}

function apiKey(): string {
  return env().OPENROUTER_API_KEY;
}

const HONESTY_RULES = `Ground every claim. Never invent statistics, quotes, or sources.
When a claim cannot be grounded in the provided context, set its source to null and
needsVerification to true (or list it under claims to verify). Write original content —
never reproduce wording from source material you are shown.`;

export async function generateResearch(
  seed: string,
  topic: string,
  context: { angle?: string; audience?: string; personaSummary?: string },
): Promise<{ data: ResearchV1; usage: GenUsage }> {
  if (isMockMode())
    return { data: mockResearch(seed, topic), usage: MOCK_USAGE };
  const result = await chatStructured({
    apiKey: apiKey(),
    model: routeModel("research"),
    schema: researchV1Schema,
    schemaName: "research_v1",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: `You are a short-form video research assistant. ${HONESTY_RULES}
schemaVersion must be 1.`,
      },
      {
        role: "user",
        content: `Research this video topic for a script.\nTopic: ${topic}\nAngle: ${context.angle || "(none)"}\nAudience: ${context.audience || "(unspecified)"}\nCreator persona: ${context.personaSummary || "(none provided)"}\n\nProduce an angle summary, 4-6 findings (flag anything ungrounded), audience questions, contrarian takes, and gaps.`,
      },
    ],
  });
  return {
    data: result.data,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      reportedCostUsd: result.usage.costUsd,
      servedModel: result.model,
    },
  };
}

export async function generateHooks(
  seed: string,
  topic: string,
  context: { research?: ResearchV1 | null; personaSummary?: string },
): Promise<{ data: HooksV1; usage: GenUsage }> {
  if (isMockMode()) return { data: mockHooks(seed, topic), usage: MOCK_USAGE };
  const result = await chatStructured({
    apiKey: apiKey(),
    model: routeModel("hook_generation"),
    schema: hooksV1Schema,
    schemaName: "hooks_v1",
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content: `You write original short-form video hooks and explain their mechanisms abstractly. ${HONESTY_RULES}
schemaVersion must be 1. Produce exactly 4 options.`,
      },
      {
        role: "user",
        content: `Topic: ${topic}\nPersona: ${context.personaSummary || "(none)"}\nResearch summary: ${context.research?.angleSummary ?? "(none)"}\n\nWrite 4 distinct hook options with mechanism, category, and rationale.`,
      },
    ],
  });
  return {
    data: result.data,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      reportedCostUsd: result.usage.costUsd,
      servedModel: result.model,
    },
  };
}

export async function generateScriptDraft(
  seed: string,
  input: {
    topic: string;
    hookText: string;
    research?: ResearchV1 | null;
    personaSummary?: string;
  },
): Promise<{ data: ScriptV1; usage: GenUsage }> {
  if (isMockMode()) {
    return {
      data: mockScript({ seed, topic: input.topic, hookText: input.hookText }),
      usage: MOCK_USAGE,
    };
  }
  const result = await chatStructured({
    apiKey: apiKey(),
    model: routeModel("script_writing"),
    schema: scriptV1Schema,
    schemaName: "script_v1",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You write conversational, direct-to-camera short-form video scripts. ${HONESTY_RULES}
schemaVersion must be 1. Sections must use ids "hook", "setup", "body", "cta" with kinds to match.
The hook section content must be exactly the hook the user selected. Any numbers you can't ground go in claimsToVerify as placeholders for the creator's own data.`,
      },
      {
        role: "user",
        content: `Write the script.\nTopic: ${input.topic}\nSelected hook: ${input.hookText}\nPersona: ${input.personaSummary || "(none)"}\nResearch findings:\n${(input.research?.findings ?? []).map((f) => `- ${f.claim}${f.needsVerification ? " [UNVERIFIED]" : ""}`).join("\n") || "(none)"}`,
      },
    ],
  });
  return {
    data: result.data,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      reportedCostUsd: result.usage.costUsd,
      servedModel: result.model,
    },
  };
}

export async function reviseScriptAI(
  seed: string,
  script: ScriptV1,
  instruction: string,
): Promise<{ data: ScriptV1; usage: GenUsage }> {
  if (isMockMode())
    return {
      data: mockReviseScript(seed, script, instruction),
      usage: MOCK_USAGE,
    };
  const result = await chatStructured({
    apiKey: apiKey(),
    model: routeModel("script_revision"),
    schema: scriptV1Schema,
    schemaName: "script_v1",
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `You revise video scripts precisely. Apply ONLY the requested change; keep everything else,
including section ids and headings, identical. ${HONESTY_RULES} schemaVersion must be 1.`,
      },
      {
        role: "user",
        content: `Revision instruction: ${instruction}\n\nCurrent script JSON:\n${JSON.stringify(script)}`,
      },
    ],
  });
  return {
    data: result.data,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      reportedCostUsd: result.usage.costUsd,
      servedModel: result.model,
    },
  };
}

export async function regenerateSectionAI(
  seed: string,
  script: ScriptV1,
  sectionId: string,
): Promise<{ data: ScriptV1; usage: GenUsage }> {
  if (isMockMode())
    return {
      data: mockRegenerateSection(seed, script, sectionId),
      usage: MOCK_USAGE,
    };
  const result = await chatStructured({
    apiKey: apiKey(),
    model: routeModel("script_writing"),
    schema: scriptV1Schema,
    schemaName: "script_v1",
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content: `You rewrite ONE section of a video script. Every other section must be returned byte-identical.
${HONESTY_RULES} schemaVersion must be 1.`,
      },
      {
        role: "user",
        content: `Rewrite only the section with id "${sectionId}" — fresh take, same role in the script.\n\nCurrent script JSON:\n${JSON.stringify(script)}`,
      },
    ],
  });
  // Enforce the untouched-sections contract server-side, not just by prompt.
  const merged: ScriptV1 = {
    ...script,
    sections: script.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const replacement = result.data.sections.find((r) => r.id === sectionId);
      return replacement ? { ...s, content: replacement.content } : s;
    }),
  };
  return {
    data: merged,
    usage: {
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      reportedCostUsd: result.usage.costUsd,
      servedModel: result.model,
    },
  };
}
