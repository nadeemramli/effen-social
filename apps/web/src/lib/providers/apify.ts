import "server-only";
import { z } from "zod";
import {
  classifyUrl,
  ProviderError,
  type CapabilityMatrix,
  type IngestionProvider,
  type NormalizedVideoMetadata,
  type Platform,
  type ProviderCostEstimate,
  type ProviderId,
  type ProviderRunStatus,
  type ResolvedUrl,
} from "@effen/core";
import { env } from "@/lib/env";

/**
 * Optional unofficial Instagram/TikTok ingestion via Apify actors. Disabled by
 * default (workspace provider toggles); direct upload and original-link/embed
 * fallbacks remain the supported path. This adapter reads public metadata only
 * and never attempts platform-policy circumvention.
 */

const APIFY_BASE = "https://api.apify.com/v2";

const ACTORS: Record<"instagram" | "tiktok", string> = {
  instagram: "apify~instagram-scraper",
  tiktok: "clockworks~tiktok-scraper",
};

const igItemSchema = z
  .object({
    shortCode: z.string().optional(),
    url: z.string().optional(),
    caption: z.string().nullish(),
    timestamp: z.string().nullish(),
    videoDuration: z.number().nullish(),
    displayUrl: z.string().nullish(),
    videoPlayCount: z.number().nullish(),
    likesCount: z.number().nullish(),
    commentsCount: z.number().nullish(),
    ownerUsername: z.string().nullish(),
    ownerFullName: z.string().nullish(),
    hashtags: z.array(z.string()).nullish(),
  })
  .passthrough();

const ttItemSchema = z
  .object({
    id: z.string().optional(),
    webVideoUrl: z.string().optional(),
    text: z.string().nullish(),
    createTimeISO: z.string().nullish(),
    videoMeta: z
      .object({
        duration: z.number().nullish(),
        coverUrl: z.string().nullish(),
      })
      .nullish(),
    playCount: z.number().nullish(),
    diggCount: z.number().nullish(),
    commentCount: z.number().nullish(),
    shareCount: z.number().nullish(),
    collectCount: z.number().nullish(),
    authorMeta: z
      .object({
        name: z.string().nullish(),
        nickName: z.string().nullish(),
        avatar: z.string().nullish(),
        fans: z.number().nullish(),
      })
      .nullish(),
    hashtags: z.array(z.object({ name: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

export class ApifyProvider implements IngestionProvider {
  readonly capabilities: CapabilityMatrix = {
    resolveUrl: true,
    discoverCreator: true,
    fetchVideoMetadata: true,
    acquireMedia: false,
    refreshMetrics: true,
    runStatus: true,
    costReporting: true,
  };

  constructor(
    readonly id: ProviderId,
    readonly platform: Platform & ("instagram" | "tiktok"),
  ) {}

  private token(): string {
    const t = env().APIFY_TOKEN;
    if (!t)
      throw new ProviderError(this.id, "auth", "APIFY_TOKEN is not configured");
    return t;
  }

  private async runSync(
    input: Record<string, unknown>,
    maxItems: number,
  ): Promise<unknown[]> {
    const actor = ACTORS[this.platform];
    let res: Response;
    try {
      res = await fetch(
        `${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${this.token()}&maxItems=${maxItems}&timeout=120`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(150_000),
        },
      );
    } catch (e) {
      throw new ProviderError(
        this.id,
        "transient",
        "Network failure calling Apify",
        true,
        e,
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new ProviderError(this.id, "auth", "Apify rejected the token");
    if (res.status === 429)
      throw new ProviderError(this.id, "rate_limited", "Apify rate limit");
    if (!res.ok)
      throw new ProviderError(
        this.id,
        "transient",
        `Apify error ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const items = (await res.json()) as unknown[];
    if (!Array.isArray(items))
      throw new ProviderError(
        this.id,
        "invalid_response",
        "Apify returned a non-array payload",
      );
    return items;
  }

  async resolveUrl(url: string): Promise<ResolvedUrl> {
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

  private normalizeIg(
    item: z.infer<typeof igItemSchema>,
  ): NormalizedVideoMetadata {
    const shortCode = item.shortCode ?? "";
    return {
      platform: "instagram",
      externalId: shortCode,
      canonicalUrl: `https://www.instagram.com/reel/${shortCode}/`,
      title: null,
      caption: item.caption ?? null,
      publishedAt: item.timestamp ?? null,
      durationSeconds: item.videoDuration ?? null,
      thumbnailUrl: item.displayUrl ?? null,
      creator: item.ownerUsername
        ? {
            platform: "instagram",
            externalId: item.ownerUsername,
            handle: item.ownerUsername,
            displayName: item.ownerFullName ?? null,
            avatarUrl: null,
            followerCount: null,
            profileUrl: `https://www.instagram.com/${item.ownerUsername}/`,
          }
        : null,
      metrics: {
        views: item.videoPlayCount ?? null,
        likes: item.likesCount ?? null,
        comments: item.commentsCount ?? null,
        shares: null,
        saves: null,
        capturedAt: new Date().toISOString(),
      },
      playback: { kind: "none" },
      media: { kind: "requires_upload" },
      hashtags: item.hashtags ?? [],
      language: null,
    };
  }

  private normalizeTt(
    item: z.infer<typeof ttItemSchema>,
  ): NormalizedVideoMetadata {
    const id = item.id ?? "";
    const handle = item.authorMeta?.name ?? "unknown";
    return {
      platform: "tiktok",
      externalId: id,
      canonicalUrl:
        item.webVideoUrl ?? `https://www.tiktok.com/@${handle}/video/${id}`,
      title: null,
      caption: item.text ?? null,
      publishedAt: item.createTimeISO ?? null,
      durationSeconds: item.videoMeta?.duration ?? null,
      thumbnailUrl: item.videoMeta?.coverUrl ?? null,
      creator: {
        platform: "tiktok",
        externalId: handle,
        handle,
        displayName: item.authorMeta?.nickName ?? null,
        avatarUrl: item.authorMeta?.avatar ?? null,
        followerCount: item.authorMeta?.fans ?? null,
        profileUrl: `https://www.tiktok.com/@${handle}`,
      },
      metrics: {
        views: item.playCount ?? null,
        likes: item.diggCount ?? null,
        comments: item.commentCount ?? null,
        shares: item.shareCount ?? null,
        saves: item.collectCount ?? null,
        capturedAt: new Date().toISOString(),
      },
      playback: { kind: "none" },
      media: { kind: "requires_upload" },
      hashtags: (item.hashtags ?? []).map((h) => h.name),
      language: null,
    };
  }

  async fetchVideoMetadata(resolved: ResolvedUrl) {
    const items =
      this.platform === "instagram"
        ? await this.runSync(
            {
              directUrls: [resolved.canonicalUrl],
              resultsType: "posts",
              resultsLimit: 1,
            },
            1,
          )
        : await this.runSync({ postURLs: [resolved.canonicalUrl] }, 1);
    const first = items[0];
    if (!first)
      throw new ProviderError(
        this.id,
        "not_found",
        "Post not found or not public",
      );
    if (this.platform === "instagram") {
      const parsed = igItemSchema.safeParse(first);
      if (!parsed.success)
        throw new ProviderError(
          this.id,
          "invalid_response",
          "Instagram payload failed validation",
        );
      return { video: this.normalizeIg(parsed.data), raw: sanitizeRaw(first) };
    }
    const parsed = ttItemSchema.safeParse(first);
    if (!parsed.success)
      throw new ProviderError(
        this.id,
        "invalid_response",
        "TikTok payload failed validation",
      );
    return { video: this.normalizeTt(parsed.data), raw: sanitizeRaw(first) };
  }

  async discoverCreator(
    ref: { externalId?: string; handle?: string; url?: string },
    opts: { maxItems: number },
  ) {
    const handle = (ref.handle ?? ref.externalId ?? "").replace(/^@/, "");
    const items =
      this.platform === "instagram"
        ? await this.runSync(
            {
              directUrls: [`https://www.instagram.com/${handle}/`],
              resultsType: "posts",
              resultsLimit: opts.maxItems,
            },
            opts.maxItems,
          )
        : await this.runSync(
            { profiles: [handle], resultsPerPage: opts.maxItems },
            opts.maxItems,
          );

    const videos = items
      .map((i) =>
        this.platform === "instagram"
          ? igItemSchema.safeParse(i)
          : ttItemSchema.safeParse(i),
      )
      .filter((r) => r.success)
      .map((r) =>
        this.platform === "instagram"
          ? this.normalizeIg(r.data as z.infer<typeof igItemSchema>)
          : this.normalizeTt(r.data as z.infer<typeof ttItemSchema>),
      )
      .filter((v) => v.externalId);
    const creator = videos[0]?.creator ?? {
      platform: this.platform,
      externalId: handle,
      handle,
      displayName: null,
      avatarUrl: null,
      followerCount: null,
      profileUrl:
        this.platform === "instagram"
          ? `https://www.instagram.com/${handle}/`
          : `https://www.tiktok.com/@${handle}`,
    };
    return { creator, videos, raw: sanitizeRaw(items.slice(0, 3)) };
  }

  async refreshMetrics(resolved: ResolvedUrl) {
    const { video, raw } = await this.fetchVideoMetadata(resolved);
    return { metrics: video.metrics, raw };
  }

  async getRunStatus(runId: string): Promise<ProviderRunStatus> {
    const res = await fetch(
      `${APIFY_BASE}/actor-runs/${runId}?token=${this.token()}`,
      {
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok)
      throw new ProviderError(
        this.id,
        "transient",
        `Apify run status error ${res.status}`,
      );
    const body = (await res.json()) as {
      data?: {
        id: string;
        status: string;
        startedAt?: string;
        finishedAt?: string;
        stats?: { itemCount?: number };
        usageTotalUsd?: number;
      };
    };
    const d = body.data;
    if (!d)
      throw new ProviderError(this.id, "invalid_response", "Missing run data");
    const state =
      d.status === "SUCCEEDED"
        ? "succeeded"
        : d.status === "FAILED"
          ? "failed"
          : d.status === "ABORTED"
            ? "aborted"
            : d.status === "READY"
              ? "queued"
              : "running";
    return {
      runId: d.id,
      state,
      itemsProduced: d.stats?.itemCount ?? null,
      chargeUsd: d.usageTotalUsd ?? null,
      startedAt: d.startedAt ?? null,
      finishedAt: d.finishedAt ?? null,
      errorMessage: d.status === "FAILED" ? "Actor run failed" : null,
    };
  }

  estimateCost(
    operation: "discover" | "metadata" | "metrics",
    itemCount: number,
  ): ProviderCostEstimate {
    const per = 0.0035;
    return {
      estimatedUsd: itemCount * per,
      basis: `~$${per} per result (Apify pay-per-result pricing; verify on the actor page)`,
    };
  }
}

/** Strip anything that looks like a credential/session field before persisting raw payloads. */
function sanitizeRaw(value: unknown): unknown {
  const BLOCKED = /token|cookie|session|secret|authorization|password/i;
  if (Array.isArray(value)) return value.map(sanitizeRaw);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !BLOCKED.test(k))
        .map(([k, v]) => [k, sanitizeRaw(v)]),
    );
  }
  return value;
}
