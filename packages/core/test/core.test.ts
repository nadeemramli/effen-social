import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  PipelineTransitionError,
  pipelineProgress,
} from "../src/domain/pipeline";
import {
  engagementRate,
  outlierScore,
  outlierBucket,
} from "../src/domain/metrics";
import { classifyUrl } from "../src/domain/urls";
import { evaluateBudget, DEFAULT_BUDGET } from "../src/domain/budget";
import { backoffSeconds } from "../src/jobs/types";
import { analysisV1Schema } from "../src/schemas/analysis";
import {
  estimateSpokenSeconds,
  scriptMarkdown,
  scriptV1Schema,
} from "../src/schemas/script";
import {
  resolveRoute,
  estimateOperationUsd,
  MODEL_ROUTES,
} from "../src/ai/routing";

describe("pipeline state machine", () => {
  it("allows the happy path", () => {
    const path = [
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
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("metadata_ready", "analyzing")).toBe(false);
    expect(() => assertTransition("complete", "normalizing")).toThrow(
      PipelineTransitionError,
    );
    expect(canTransition("failed_permanent", "analyzing")).toBe(false);
    expect(canTransition("policy_blocked", "discovering")).toBe(false);
  });

  it("allows retry from retryable failure and budget block", () => {
    expect(canTransition("failed_retryable", "acquiring_media")).toBe(true);
    expect(canTransition("budget_blocked", "analyzing")).toBe(true);
    expect(canTransition("complete", "selected_for_analysis")).toBe(true); // re-analysis
  });

  it("reports progress on happy path only", () => {
    expect(pipelineProgress("created")).toBe(0);
    expect(pipelineProgress("complete")).toBe(1);
    expect(pipelineProgress("failed_retryable")).toBeNull();
  });
});

describe("metrics", () => {
  it("computes engagement from reported fields only", () => {
    expect(
      engagementRate({
        views: 1000,
        likes: 50,
        comments: 10,
        shares: null,
        saves: null,
      }),
    ).toBeCloseTo(0.06);
    expect(
      engagementRate({
        views: null,
        likes: 50,
        comments: 1,
        shares: 0,
        saves: 0,
      }),
    ).toBeNull();
    expect(
      engagementRate({
        views: 100,
        likes: null,
        comments: null,
        shares: null,
        saves: null,
      }),
    ).toBeNull();
  });

  it("returns insufficient history under the minimum sample", () => {
    const r = outlierScore(5000, [100, 200, null, 300]);
    expect(r.kind).toBe("insufficient_history");
  });

  it("scores against the trailing median", () => {
    const r = outlierScore(1000, [100, 200, 100, 200, 100, 200]);
    expect(r).toMatchObject({ kind: "score", medianViews: 150 });
    if (r.kind === "score") {
      expect(r.score).toBeCloseTo(1000 / 150);
      expect(outlierBucket(r.score)).toBe("breakout");
    }
  });

  it("never scores a null-view video", () => {
    expect(outlierScore(null, [1, 2, 3, 4, 5, 6]).kind).toBe(
      "insufficient_history",
    );
  });
});

describe("url classification", () => {
  it("canonicalizes youtube variants", () => {
    for (const u of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(classifyUrl(u)).toMatchObject({
        platform: "youtube",
        kind: "video",
        externalId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
    }
  });

  it("classifies instagram reels and tiktok videos", () => {
    expect(
      classifyUrl("https://www.instagram.com/reel/Cxyz123AbCd/?igsh=1"),
    ).toMatchObject({
      platform: "instagram",
      kind: "video",
      externalId: "Cxyz123AbCd",
    });
    expect(
      classifyUrl(
        "https://www.tiktok.com/@some.user/video/7301234567890123456",
      ),
    ).toMatchObject({
      platform: "tiktok",
      kind: "video",
      externalId: "7301234567890123456",
    });
  });

  it("classifies creator urls", () => {
    expect(classifyUrl("https://youtube.com/@mkbhd")).toMatchObject({
      platform: "youtube",
      kind: "creator",
    });
    expect(classifyUrl("https://www.tiktok.com/@chef")).toMatchObject({
      platform: "tiktok",
      kind: "creator",
      externalId: "chef",
    });
  });

  it("rejects junk and non-http schemes", () => {
    expect(classifyUrl("not a url")).toBeNull();
    expect(classifyUrl("ftp://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(classifyUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("budget", () => {
  const usage = { spentTodayUsd: 4.5, spentMonthUsd: 20 };
  it("blocks when a run would exceed the daily budget", () => {
    const d = evaluateBudget(DEFAULT_BUDGET, usage, {
      estimatedUsd: 1,
      itemCount: 3,
    });
    expect(d).toMatchObject({ allowed: false, reason: "daily_budget" });
  });
  it("blocks per-run item and charge caps before budgets", () => {
    expect(
      evaluateBudget(DEFAULT_BUDGET, usage, {
        estimatedUsd: 0.1,
        itemCount: 999,
      }),
    ).toMatchObject({ allowed: false, reason: "per_run_items" });
    expect(
      evaluateBudget(
        DEFAULT_BUDGET,
        { spentTodayUsd: 0, spentMonthUsd: 0 },
        { estimatedUsd: 3, itemCount: 1 },
      ),
    ).toMatchObject({ allowed: false, reason: "per_run_charge" });
  });
  it("allows within budget and reports remaining", () => {
    const d = evaluateBudget(
      DEFAULT_BUDGET,
      { spentTodayUsd: 1, spentMonthUsd: 5 },
      { estimatedUsd: 0.5, itemCount: 2 },
    );
    expect(d).toMatchObject({ allowed: true });
  });
});

describe("jobs", () => {
  it("backs off exponentially with a cap", () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(3)).toBe(480);
    expect(backoffSeconds(10)).toBe(1800);
  });
});

describe("ai routing", () => {
  it("forces mock provider in mock mode", () => {
    const r = resolveRoute("script_writing", {}, true);
    expect(r.provider).toBe("mock");
    expect(r.model).toContain("mock:");
  });
  it("honors env overrides in real mode", () => {
    const r = resolveRoute(
      "script_writing",
      { EFFEN_MODEL_SCRIPT: "custom-model" },
      false,
    );
    expect(r.model).toBe("custom-model");
  });
  it("estimates token and media costs", () => {
    const usd = estimateOperationUsd(MODEL_ROUTES.script_writing, {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    });
    expect(usd).toBeCloseTo(1.25 + 1.0);
    const media = estimateOperationUsd(MODEL_ROUTES.transcription, {
      mediaMinutes: 10,
    });
    expect(media).toBeCloseTo(0.03);
  });
});

describe("schemas", () => {
  it("rejects an analysis missing required grounding fields", () => {
    expect(
      analysisV1Schema.safeParse({ schemaVersion: 1, summary: "x" }).success,
    ).toBe(false);
  });
  it("round-trips a script and renders markdown + duration", () => {
    const script = scriptV1Schema.parse({
      schemaVersion: 1,
      title: "Test",
      sections: [
        {
          id: "s1",
          kind: "hook",
          heading: "Hook",
          content: "Ten words here to make a hook line now.",
        },
        {
          id: "s2",
          kind: "body",
          heading: "Body",
          content: "More words follow.",
        },
      ],
      claimsToVerify: ["A stat"],
      deliveryNotes: null,
    });
    const md = scriptMarkdown(script);
    expect(md).toContain("## Hook");
    expect(md).toContain("- [ ] A stat");
    expect(estimateSpokenSeconds("word ".repeat(150))).toBe(60);
  });
});
