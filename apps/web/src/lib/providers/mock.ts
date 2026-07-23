import "server-only";
import {
  classifyUrl,
  ProviderError,
  type CapabilityMatrix,
  type IngestionProvider,
  type NormalizedCreator,
  type NormalizedVideoMetadata,
  type Platform,
  type ProviderCostEstimate,
  type ProviderId,
  type ProviderRunStatus,
  type ResolvedUrl,
} from "@effen/core";

/**
 * Deterministic ingestion fixtures for mock mode. Metadata is derived from the
 * external id, so the same URL always yields the same creator, metrics, and
 * publish date — which makes duplicate handling and outlier scores testable.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const CREATORS = [
  { handle: "daily.creator.lab", name: "Daily Creator Lab" },
  { handle: "shortform.notes", name: "Shortform Notes" },
  { handle: "the.retention.guy", name: "The Retention Guy" },
  { handle: "storyboard.jess", name: "Storyboard Jess" },
] as const;

const TITLES = [
  "I posted daily for 30 days — the data no one shows",
  "The 3-second rule that saved my completion rate",
  "Why boring hooks outperform clever ones",
  "One editing change, +212% average watch time",
  "Stop copying viral formats (do this instead)",
  "The posting schedule myth, tested",
  "How I script a short in 12 minutes",
  "Your first 100 videos are the experiment",
] as const;

export class MockIngestionProvider implements IngestionProvider {
  readonly capabilities: CapabilityMatrix = {
    resolveUrl: true,
    discoverCreator: true,
    fetchVideoMetadata: true,
    acquireMedia: false,
    refreshMetrics: true,
    runStatus: false,
    costReporting: true,
  };

  constructor(
    readonly id: ProviderId,
    readonly platform: Platform,
    /** Simulate an outage (provider_down) for failure-path testing. */
    private readonly simulateOutage = false,
  ) {}

  private guard() {
    if (this.simulateOutage) {
      throw new ProviderError(
        this.id,
        "provider_down",
        "Simulated provider outage (mock)",
      );
    }
  }

  async resolveUrl(url: string): Promise<ResolvedUrl> {
    this.guard();
    const classified = classifyUrl(url);
    if (!classified || classified.platform !== this.platform) {
      throw new ProviderError(
        this.id,
        "unsupported_url",
        `Not a recognized ${this.platform} URL`,
      );
    }
    return classified;
  }

  private creatorFor(seed: number): NormalizedCreator {
    const c = CREATORS[seed % CREATORS.length]!;
    return {
      platform: this.platform,
      externalId: `mock-${c.handle}`,
      handle: c.handle,
      displayName: c.name,
      avatarUrl: null,
      followerCount: 12_000 + (seed % 90) * 1_000,
      profileUrl:
        this.platform === "youtube"
          ? `https://www.youtube.com/@${c.handle}`
          : this.platform === "tiktok"
            ? `https://www.tiktok.com/@${c.handle}`
            : `https://www.instagram.com/${c.handle}/`,
    };
  }

  private videoFor(
    externalId: string,
    canonicalUrl: string,
  ): NormalizedVideoMetadata {
    const seed = hash(`${this.platform}:${externalId}`);
    const views = 2_000 + (seed % 400_000);
    const daysAgo = (seed % 90) + 1;
    return {
      platform: this.platform,
      externalId,
      canonicalUrl,
      title: TITLES[seed % TITLES.length]!,
      caption: `${TITLES[(seed + 3) % TITLES.length]} #creator #shortform #${this.platform}`,
      publishedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      durationSeconds: 18 + (seed % 70),
      thumbnailUrl: null,
      creator: this.creatorFor(seed),
      metrics: {
        views,
        likes: Math.round(views * (0.02 + (seed % 10) / 150)),
        comments: Math.round(views * 0.004),
        shares: this.platform === "youtube" ? null : Math.round(views * 0.006),
        saves: this.platform === "instagram" ? Math.round(views * 0.01) : null,
        capturedAt: new Date().toISOString(),
      },
      playback:
        this.platform === "youtube"
          ? {
              kind: "embed",
              embedUrl: `https://www.youtube-nocookie.com/embed/${externalId}`,
            }
          : { kind: "none" },
      media: { kind: "requires_upload" },
      hashtags: ["creator", "shortform", this.platform],
      language: "en",
    };
  }

  async fetchVideoMetadata(resolved: ResolvedUrl) {
    this.guard();
    const video = this.videoFor(resolved.externalId, resolved.canonicalUrl);
    return {
      video,
      raw: {
        mock: true,
        source: "MockIngestionProvider",
        externalId: resolved.externalId,
      },
    };
  }

  async discoverCreator(
    ref: { externalId?: string; handle?: string; url?: string },
    opts: { maxItems: number },
  ) {
    this.guard();
    const handle = ref.handle ?? ref.externalId ?? "creator";
    const seed = hash(`${this.platform}:${handle}`);
    const creator = {
      ...this.creatorFor(seed),
      handle: handle.replace(/^@/, ""),
      externalId: handle.replace(/^@/, ""),
    };
    const count = Math.min(opts.maxItems, 12);
    const videos = Array.from({ length: count }, (_, i) => {
      const vid = `${handle
        .replace(/^@/, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 6)}${(seed % 1000) + i}`;
      const canonical =
        this.platform === "youtube"
          ? `https://www.youtube.com/watch?v=${vid.padEnd(11, "x").slice(0, 11)}`
          : this.platform === "tiktok"
            ? `https://www.tiktok.com/@${creator.handle}/video/7${String(seed + i).padStart(18, "0")}`
            : `https://www.instagram.com/reel/${vid.padEnd(11, "A")}/`;
      const externalId =
        this.platform === "youtube"
          ? vid.padEnd(11, "x").slice(0, 11)
          : this.platform === "tiktok"
            ? `7${String(seed + i).padStart(18, "0")}`
            : vid.padEnd(11, "A");
      return { ...this.videoFor(externalId, canonical), creator };
    });
    return { creator, videos, raw: { mock: true, handle, count } };
  }

  async refreshMetrics(resolved: ResolvedUrl) {
    this.guard();
    const base = this.videoFor(
      resolved.externalId,
      resolved.canonicalUrl,
    ).metrics;
    // Metrics drift upward over time deterministically by day.
    const dayBucket = Math.floor(Date.now() / 86_400_000);
    const drift = 1 + (hash(`${resolved.externalId}:${dayBucket}`) % 60) / 1000;
    return {
      metrics: {
        ...base,
        views: base.views == null ? null : Math.round(base.views * drift),
        likes: base.likes == null ? null : Math.round(base.likes * drift),
        capturedAt: new Date().toISOString(),
      },
      raw: { mock: true, drift },
    };
  }

  async getRunStatus(): Promise<ProviderRunStatus> {
    throw new ProviderError(
      this.id,
      "unsupported_url",
      "Mock provider has no async runs",
    );
  }

  estimateCost(
    operation: "discover" | "metadata" | "metrics",
    itemCount: number,
  ): ProviderCostEstimate {
    if (this.platform === "youtube") {
      return {
        estimatedUsd: 0,
        basis: "YouTube Data API quota units (no direct charge)",
      };
    }
    const per = operation === "discover" ? 0.003 : 0.002;
    return {
      estimatedUsd: itemCount * per,
      basis: `$${per.toFixed(3)} per item (Apify actor pricing, mock estimate)`,
    };
  }
}
