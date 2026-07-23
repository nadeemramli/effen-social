/**
 * Normalized ingestion-provider interface.
 * Product code (UI, API routes, jobs) may only depend on these types — never on a
 * provider SDK's raw response shapes. Raw payloads are persisted separately for
 * diagnostics via `raw_provider_payloads`.
 */

export const PLATFORMS = ["youtube", "instagram", "tiktok", "upload"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PROVIDER_IDS = [
  "manual_upload",
  "youtube_official",
  "instagram_apify",
  "tiktok_apify",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/* ------------------------------------------------------------------ errors */

export type ProviderErrorKind =
  | "not_found" // video/creator does not exist or is deleted
  | "private" // exists but not publicly accessible
  | "rate_limited" // provider throttled us; retry with backoff
  | "auth" // bad/expired credentials
  | "quota_exhausted" // provider-side quota (e.g. YouTube daily units)
  | "unsupported_url" // URL not recognized by this provider
  | "policy" // provider terms forbid this operation
  | "transient" // network/5xx; retryable
  | "invalid_response" // response failed schema validation
  | "provider_down"; // sustained outage detected

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly retryable: boolean = kind === "rate_limited" ||
      kind === "transient" ||
      kind === "provider_down",
    public readonly cause?: unknown,
  ) {
    super(`[${provider}/${kind}] ${message}`);
    this.name = "ProviderError";
  }
}

/* ------------------------------------------------------------ normalized data */

export interface ResolvedUrl {
  platform: Platform;
  /** Canonical form used for duplicate detection, e.g. https://www.youtube.com/watch?v=ID */
  canonicalUrl: string;
  /** Platform-native id, e.g. YouTube video id, IG shortcode, TikTok id. */
  externalId: string;
  kind: "video" | "creator";
}

export interface NormalizedCreator {
  platform: Platform;
  externalId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  profileUrl: string;
}

export interface NormalizedVideoMetadata {
  platform: Platform;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  caption: string | null;
  publishedAt: string | null; // ISO 8601
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  creator: NormalizedCreator | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    capturedAt: string; // ISO 8601 — when these numbers were observed
  };
  /** How playback is possible without violating platform terms. */
  playback: { kind: "embed"; embedUrl: string } | { kind: "none" };
  /** Direct media acquisition, if the provider legitimately supplies one. */
  media:
    | { kind: "direct_url"; url: string; expiresAt: string | null }
    | { kind: "requires_upload" }
    | { kind: "stored" }; // manual uploads: already in our storage
  hashtags: string[];
  language: string | null;
}

export interface ProviderRunStatus {
  runId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "aborted";
  itemsProduced: number | null;
  /** Reported charge in USD, when the provider exposes it (e.g. Apify). */
  chargeUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface ProviderCostEstimate {
  /** Estimated USD for the operation, null when the provider gives no basis. */
  estimatedUsd: number | null;
  basis: string; // human-readable explanation, e.g. "$2.30 per 1000 results"
}

/* --------------------------------------------------------------- interface */

export interface CapabilityMatrix {
  resolveUrl: boolean;
  discoverCreator: boolean;
  fetchVideoMetadata: boolean;
  acquireMedia: boolean;
  refreshMetrics: boolean;
  runStatus: boolean;
  costReporting: boolean;
}

/**
 * A single ingestion provider. Implementations must throw ProviderError for all
 * failure modes and must never return raw provider response objects.
 */
export interface IngestionProvider {
  readonly id: ProviderId;
  readonly platform: Platform;
  readonly capabilities: CapabilityMatrix;

  /** Classify + canonicalize a user-pasted URL. Throws unsupported_url otherwise. */
  resolveUrl(url: string): Promise<ResolvedUrl>;

  /** List recent videos for a creator (metadata only; cheap discovery pass). */
  discoverCreator(
    creatorRef: { externalId?: string; handle?: string; url?: string },
    opts: { maxItems: number },
  ): Promise<{
    creator: NormalizedCreator;
    videos: NormalizedVideoMetadata[];
    raw: unknown;
  }>;

  /** Fetch metadata for one video. */
  fetchVideoMetadata(
    resolved: ResolvedUrl,
  ): Promise<{ video: NormalizedVideoMetadata; raw: unknown }>;

  /** Refresh metric counts without any media processing or AI. */
  refreshMetrics(resolved: ResolvedUrl): Promise<{
    metrics: NormalizedVideoMetadata["metrics"];
    raw: unknown;
  }>;

  /** Status of an async provider run (Apify actor runs); throws if unsupported. */
  getRunStatus(runId: string): Promise<ProviderRunStatus>;

  /** Cost estimate for a discovery/metadata operation of `itemCount` items. */
  estimateCost(
    operation: "discover" | "metadata" | "metrics",
    itemCount: number,
  ): ProviderCostEstimate;
}
