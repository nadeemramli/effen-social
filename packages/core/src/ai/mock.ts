import type { AnalysisV1 } from "../schemas/analysis";
import { analysisV1Schema } from "../schemas/analysis";
import type { HooksV1, ResearchV1, ScriptV1 } from "../schemas/script";
import {
  hooksV1Schema,
  researchV1Schema,
  scriptV1Schema,
} from "../schemas/script";

/**
 * Deterministic development AI adapters. Content is generated from a seed
 * (content checksum / entity id), so re-runs are reproducible and cache
 * behavior can be tested. Every output validates against the same schemas the
 * live adapters must satisfy. Mock mode is visibly labeled in the UI.
 */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)]!;
}

const TOPICS = [
  {
    topic: "Repurposing long-form content into shorts",
    audience: "Solo creators and small content teams",
  },
  {
    topic: "Hook writing under 3 seconds",
    audience: "Short-form video creators fighting drop-off",
  },
  {
    topic: "Posting cadence vs. quality trade-offs",
    audience: "Creators balancing a day job with publishing",
  },
  {
    topic: "Storytelling structure for talking-head videos",
    audience: "Educators and coaches on social video",
  },
  {
    topic: "Analytics-driven content iteration",
    audience: "Data-minded creators optimizing reach",
  },
] as const;

const HOOK_CATS = [
  "curiosity_gap",
  "bold_claim",
  "question",
  "pattern_interrupt",
  "relatable_pain",
  "contrarian",
] as const;
const FORMATS = [
  "listicle",
  "tutorial",
  "story",
  "hot_take",
  "case_study",
  "myth_bust",
] as const;

export interface MockAnalysisInput {
  seed: string;
  durationSeconds: number;
  title?: string | null;
  metrics?: {
    views: number | null;
    likes: number | null;
    comments: number | null;
  } | null;
}

export function mockAnalysis(input: MockAnalysisInput): AnalysisV1 {
  const r = rng(`analysis:${input.seed}`);
  const t = pick(r, TOPICS);
  const dur = Math.max(8, input.durationSeconds);
  const segCount = Math.max(3, Math.min(12, Math.round(dur / 6)));
  const segLen = dur / segCount;

  const sentences = [
    "So here's the part nobody tells you about this.",
    "I tested this for thirty days straight and tracked everything.",
    "The first version completely flopped, and that was the point.",
    "Most people quit right before the numbers turn.",
    "Here's the exact framework, step by step.",
    "Watch what happens when we change just one variable.",
    "That one change doubled the completion rate.",
    "If you only remember one thing, make it this.",
    "The data surprised me more than anyone.",
    "And that's why the boring version wins.",
    "Save this for your next filming session.",
    "Tomorrow I'll show you the follow-up experiment.",
  ];

  const transcript = Array.from({ length: segCount }, (_, i) => ({
    start: Math.round(i * segLen * 10) / 10,
    end: Math.round(Math.min(dur, (i + 1) * segLen) * 10) / 10,
    text: sentences[(hashSeed(input.seed) + i) % sentences.length]!,
    speaker: null,
  }));

  const hookCat = pick(r, HOOK_CATS);
  const views = input.metrics?.views ?? null;
  const likes = input.metrics?.likes ?? null;

  const analysis: AnalysisV1 = {
    schemaVersion: 1,
    summary: `A ${Math.round(dur)}s talking-head piece on ${t.topic.toLowerCase()}. It opens on a ${hookCat.replace("_", " ")} hook, walks through one concrete experiment, and closes with a save-worthy takeaway.`,
    targetAudience: t.audience,
    topic: t.topic,
    primaryMessage:
      "Systematic iteration beats one-off virality; structure the video so the payoff lands in the final third.",
    transcript,
    transcriptSource: "dedicated_stt",
    onScreenText: [
      { start: 0, end: 2.4, text: "the 30-day test", role: "hook" },
      {
        start: Math.round(dur * 0.5 * 10) / 10,
        end: Math.round(dur * 0.55 * 10) / 10,
        text: "day 14: +212%",
        role: "label",
      },
      {
        start: Math.round(dur * 0.9 * 10) / 10,
        end: null,
        text: "follow for part 2",
        role: "cta",
      },
    ],
    hook: {
      mechanism: `Opens with a ${hookCat.replace("_", " ")} that names the audience's exact situation before revealing any content, forcing a "wait, that's me" moment inside the first two seconds.`,
      category: hookCat,
      sourceQuote: transcript[0]!.text,
      windowSeconds: Math.round(Math.min(3, segLen) * 10) / 10,
      whyItWorks:
        "It withholds the resolution while making the stakes personal, which is what keeps the first-3-second retention high on this clip.",
      confidence: "medium",
    },
    beats: [
      {
        start: 0,
        end: Math.round(dur * 0.15 * 10) / 10,
        beat: "Hook",
        description: "Problem named, promise implied.",
      },
      {
        start: Math.round(dur * 0.15 * 10) / 10,
        end: Math.round(dur * 0.45 * 10) / 10,
        beat: "Setup",
        description: "The experiment and its constraint are established.",
      },
      {
        start: Math.round(dur * 0.45 * 10) / 10,
        end: Math.round(dur * 0.8 * 10) / 10,
        beat: "Escalation",
        description:
          "One variable changes; tension builds toward the number reveal.",
      },
      {
        start: Math.round(dur * 0.8 * 10) / 10,
        end: null,
        beat: "Payoff + CTA",
        description:
          "Result revealed, single takeaway, soft save/follow prompt.",
      },
    ],
    visualPatterns: [
      {
        pattern: "Center-framed talking head with punch-in cuts on emphasis",
        timestamps: [
          0,
          Math.round(dur * 0.3 * 10) / 10,
          Math.round(dur * 0.7 * 10) / 10,
        ],
        notes: "Cut rhythm roughly every 4–6 seconds.",
      },
      {
        pattern: "Keyword captions synced to speech",
        timestamps: [1, Math.round(dur * 0.5 * 10) / 10],
        notes: null,
      },
    ],
    editingNotes:
      "Hard cuts only; no transitions. B-roll appears only during the escalation beat, keeping the payoff on the speaker's face.",
    performanceContext: {
      interpretation:
        views != null
          ? `With ${views.toLocaleString()} views${likes != null ? ` and ${likes.toLocaleString()} likes` : ""}, this clip performs against the source's recent baseline (see outlier score in the library); the retention-oriented structure is the most plausible driver.`
          : "No reliable view metrics were provided for this video, so no performance claim is made.",
      referencedMetrics:
        views != null ? ["views", ...(likes != null ? ["likes"] : [])] : [],
      confidence: views != null ? "medium" : "low",
    },
    uncertainties: [
      "Speaker attribution is unavailable (single-speaker assumed).",
      "On-screen text timing is approximate to ±0.5s.",
      ...(views == null
        ? ["Platform metrics were unavailable at analysis time."]
        : []),
    ],
    overallConfidence: "medium",
    ideaCandidates: Array.from({ length: 3 }, (_, i) => {
      const fmt = pick(r, FORMATS);
      return {
        title: [
          `Run your own 30-day ${t.topic.toLowerCase()} test`,
          `The one-variable rule for ${t.topic.toLowerCase()}`,
          `Why your ${t.topic.toLowerCase().split(" ")[0]} flops (and the boring fix)`,
        ][i]!,
        angle: `Adapt the ${["experiment-diary", "single-variable", "failure-first"][i]} structure to your niche with your own data instead of the source's.`,
        originalityRationale:
          "Borrows the structural mechanism (constraint + single-variable reveal), not the source's topic, wording, or data.",
        personaRelevance:
          "Matches a persona focused on practical, evidence-backed creator education.",
        storytellingFormat: fmt,
        evidence: [
          `hook@0s`,
          `beat:Escalation@${Math.round(dur * 0.45)}s`,
          views != null ? `views:${views}` : "transcript:full",
        ],
        copyingRisk: i === 0 ? "medium" : "low",
        copyingRiskNote:
          i === 0
            ? "Same experiment format in the same niche could read as imitation — swap the metric and the constraint."
            : null,
      };
    }),
    copyingRiskWarnings: [
      "Do not reuse the source's on-screen numbers or claimed results; run your own test.",
      "The opening line is quoted for evidence only — write an original hook.",
    ],
    safetyFlags: [],
  };
  return analysisV1Schema.parse(analysis);
}

export function mockResearch(seed: string, topic: string): ResearchV1 {
  const r = rng(`research:${seed}`);
  const research: ResearchV1 = {
    schemaVersion: 1,
    angleSummary: `The strongest angle on "${topic}" is a first-person experiment with one measurable outcome, because the audience is saturated with generic advice and responds to evidence.`,
    findings: [
      {
        claim:
          "Short-form completion rate correlates more with hook clarity than production quality.",
        support:
          "Consistent pattern across analyzed library videos with above-median outlier scores.",
        source: "workspace library analysis",
        needsVerification: false,
      },
      {
        claim: `Median watch time for ${topic.toLowerCase()} content sits under 60% of clip length.`,
        support: "Model prior; no workspace data confirms this yet.",
        source: null,
        needsVerification: true,
      },
      {
        claim:
          "Videos that state a constraint (time, budget, count) in the first 5 seconds retain better.",
        support: "Observed in the hook mechanisms of shortlisted analyses.",
        source: "hook library",
        needsVerification: false,
      },
      {
        claim:
          "Platform algorithm details change frequently; specific mechanics claims age fast.",
        support: "General volatility of platform ranking systems.",
        source: null,
        needsVerification: true,
      },
    ],
    audienceQuestions: [
      `How do I start with ${topic.toLowerCase()} if I have under 1,000 followers?`,
      "How long before I should expect results?",
      "What tools do I actually need on day one?",
    ],
    contrarianTakes: [
      pick(r, [
        "Consistency is overrated — iteration quality beats posting frequency.",
        "Trends are a tax on small creators; evergreen formats compound instead.",
        "Your analytics dashboard is lying to you about why videos fail.",
      ]),
    ],
    gaps: [
      "No workspace data yet on this exact topic — findings marked for verification should be checked before recording.",
    ],
  };
  return researchV1Schema.parse(research);
}

export function mockHooks(seed: string, topic: string): HooksV1 {
  const r = rng(`hooks:${seed}`);
  void r();
  const t = topic.toLowerCase();
  const hooks: HooksV1 = {
    schemaVersion: 1,
    options: [
      {
        text: `I spent 30 days on ${t} so you don't have to — here's the only part that mattered.`,
        mechanism:
          "Time-investment proxy: creator absorbs the cost, viewer gets the distilled payoff.",
        category: "curiosity_gap",
        rationale:
          "Concrete constraint plus withheld payoff; works when the body delivers one clear result.",
      },
      {
        text: `Everyone teaching ${t} is skipping step zero.`,
        mechanism:
          "Contrarian gap: implies received wisdom is incomplete and names a missing prerequisite.",
        category: "contrarian",
        rationale:
          "Positions the video against the genre; strong for saturated topics.",
      },
      {
        text: `If your ${t.split(" ")[0]} flopped this week, this is probably why.`,
        mechanism:
          "Relatable-pain targeting: addresses viewers mid-failure at the moment they're searching for a reason.",
        category: "relatable_pain",
        rationale:
          "Self-selecting hook — lower reach, much higher relevance and completion.",
      },
      {
        text: `The boring version of ${t} outperformed the viral one. I have the numbers.`,
        mechanism: "Expectation inversion backed by claimed evidence.",
        category: "bold_claim",
        rationale:
          "Sets up a data reveal; requires the script to actually show numbers.",
      },
    ],
  };
  return hooksV1Schema.parse(hooks);
}

export interface MockScriptInput {
  seed: string;
  topic: string;
  hookText: string;
  targetSeconds?: number;
}

export function mockScript(input: MockScriptInput): ScriptV1 {
  const t = input.topic;
  const script: ScriptV1 = {
    schemaVersion: 1,
    title: t.length > 60 ? t.slice(0, 57) + "…" : t,
    sections: [
      { id: "hook", kind: "hook", heading: "Hook", content: input.hookText },
      {
        id: "setup",
        kind: "setup",
        heading: "Setup",
        content: `Quick context: I kept seeing the same advice about ${t.toLowerCase()}, and none of it came with evidence. So I set one rule for myself — change a single variable, measure one number, and don't touch anything else for two weeks.`,
      },
      {
        id: "body",
        kind: "body",
        heading: "Body",
        content: `Week one was the control: no changes, just measurement. Baseline set.\n\nWeek two, the one change. Not the fancy version — the boring one everyone skips because it doesn't feel creative.\n\nThe result: a clear, repeatable lift on the number I was tracking. Not a fluke — I re-ran it to be sure.\n\nWhy it works: the change removes friction at the exact moment people decide to stop watching. Nothing about it requires talent, budget, or luck. It requires deciding to measure.`,
      },
      {
        id: "cta",
        kind: "cta",
        heading: "CTA",
        content: `Run the two-week version yourself: one variable, one number. Save this so week one actually starts, and tell me what you're measuring — I read every comment.`,
      },
    ],
    claimsToVerify: [
      "Replace the placeholder result with your real measured numbers before recording.",
      "Confirm the baseline/lift figures from your own analytics — the draft intentionally contains no fabricated statistics.",
    ],
    deliveryNotes:
      "Conversational, direct-to-camera. Punch-in on the result reveal. Keep the CTA under 8 seconds.",
  };
  return scriptV1Schema.parse(script);
}

/** Regenerate a single section without touching the others. */
export function mockRegenerateSection(
  seed: string,
  script: ScriptV1,
  sectionId: string,
): ScriptV1 {
  const r = rng(`regen:${seed}:${sectionId}`);
  const variants: Record<string, string[]> = {
    hook: [
      "Stop scripting your videos backwards — the last line is the one that decides if anyone stays.",
      "I deleted my best-performing video's formula and started over. Here's what survived.",
    ],
    setup: [
      "Context in ten seconds: everyone repeats the same playbook, nobody shows receipts. I wanted receipts, so I built a tiny experiment instead of an opinion.",
    ],
    body: [
      "Day one through seven: measure, touch nothing. That baseline felt useless — it wasn't; it's the whole trick.\n\nThen one deliberate change, held for a full week. The number moved, and kept moving when I repeated it.\n\nThe mechanism is simple: you removed a reason to leave at the exact second people decide to leave.",
    ],
    cta: [
      "Your turn: pick one number, change one thing, wait two weeks. Save this as the reminder — and comment what you're testing so I can follow up.",
    ],
  };
  const pool = variants[sectionId] ?? [
    `Revised ${sectionId} content (mock regeneration).`,
  ];
  return {
    ...script,
    sections: script.sections.map((s) =>
      s.id === sectionId ? { ...s, content: pick(r, pool) } : s,
    ),
  };
}

/** Apply a targeted natural-language revision to the whole script (mock: annotate + lightly vary). */
export function mockReviseScript(
  seed: string,
  script: ScriptV1,
  instruction: string,
): ScriptV1 {
  const lower = instruction.toLowerCase();
  const shorten =
    lower.includes("short") ||
    lower.includes("tight") ||
    lower.includes("concise");
  return {
    ...script,
    sections: script.sections.map((s) => {
      if (shorten) {
        const sentences = s.content.split(/(?<=[.!?])\s+/);
        const kept = Math.max(1, Math.ceil(sentences.length * 0.6));
        return { ...s, content: sentences.slice(0, kept).join(" ") };
      }
      if (lower.includes("hook") && s.kind !== "hook") return s;
      return s;
    }),
    deliveryNotes:
      `${script.deliveryNotes ?? ""}\nRevision applied (${instruction.slice(0, 80)}).`.trim(),
  };
}
