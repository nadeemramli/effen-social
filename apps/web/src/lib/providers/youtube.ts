import "server-only";
import { z } from "zod";
import {
  classifyUrl,
  ProviderError,
  type CapabilityMatrix,
  type IngestionProvider,
  type NormalizedVideoMetadata,
  type ProviderCostEstimate,
  type ProviderRunStatus,
  type ResolvedUrl,
} from "@effen/core";
import { env } from "@/lib/env";

/**
 * Official YouTube Data API v3 adapter. Metadata + embedded playback only —
 * no downloading. Analysis of YouTube content uses direct-URL video
 * understanding (Gemini) where supported, or requires an authorized upload.
 */

const videoItemSchema = z.object({
  id: z.string(),
  snippet: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
      channelTitle: z.string().optional(),
      thumbnails: z
        .record(z.string(), z.object({ url: z.string() }).passthrough())
        .optional(),
      defaultAudioLanguage: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  contentDetails: z.object({ duration: z.string().optional() }).optional(),
  statistics: z
    .object({
      viewCount: z.string().optional(),
      likeCount: z.string().optional(),
      commentCount: z.string().optional(),
    })
    .optional(),
});

function iso8601DurationToSeconds(d: string): number | null {
  const m = d.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export class YouTubeOfficialProvider implements IngestionProvider {
  readonly id = "youtube_official" as const;
  readonly platform = "youtube" as const;
  readonly capabilities: CapabilityMatrix = {
    resolveUrl: true,
    discoverCreator: true,
    fetchVideoMetadata: true,
    acquireMedia: false,
    refreshMetrics: true,
    runStatus: false,
    costReporting: true,
  };

  private async call<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const key = env().YOUTUBE_API_KEY;
    if (!key)
      throw new ProviderError(
        this.id,
        "auth",
        "YOUTUBE_API_KEY is not configured",
      );
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", key);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ProviderError(
        this.id,
        "transient",
        "Network failure calling YouTube API",
        true,
        e,
      );
    }
    if (res.status === 403) {
      const body = await res.text();
      const kind = body.includes("quota") ? "quota_exhausted" : "auth";
      throw new ProviderError(
        this.id,
        kind,
        `YouTube API refused the request (${res.status})`,
      );
    }
    if (res.status === 404)
      throw new ProviderError(this.id, "not_found", "Resource not found");
    if (res.status === 429)
      throw new ProviderError(
        this.id,
        "rate_limited",
        "YouTube API rate limit",
      );
    if (!res.ok)
      throw new ProviderError(
        this.id,
        "transient",
        `YouTube API error ${res.status}`,
      );
    return (await res.json()) as T;
  }

  async resolveUrl(url: string): Promise<ResolvedUrl> {
    const classified = classifyUrl(url);
    if (!classified || classified.platform !== "youtube") {
      throw new ProviderError(
        this.id,
        "unsupported_url",
        "Not a recognized YouTube URL",
      );
    }
    return classified;
  }

  private normalize(
    item: z.infer<typeof videoItemSchema>,
  ): NormalizedVideoMetadata {
    const sn = item.snippet;
    const stats = item.statistics;
    const thumbs = sn?.thumbnails ?? {};
    const bestThumb =
      thumbs["maxres"]?.url ??
      thumbs["standard"]?.url ??
      thumbs["high"]?.url ??
      thumbs["medium"]?.url ??
      thumbs["default"]?.url ??
      null;
    return {
      platform: "youtube",
      externalId: item.id,
      canonicalUrl: `https://www.youtube.com/watch?v=${item.id}`,
      title: sn?.title ?? null,
      caption: sn?.description ?? null,
      publishedAt: sn?.publishedAt ?? null,
      durationSeconds: item.contentDetails?.duration
        ? iso8601DurationToSeconds(item.contentDetails.duration)
        : null,
      thumbnailUrl: bestThumb,
      creator: sn?.channelId
        ? {
            platform: "youtube",
            externalId: sn.channelId,
            handle: sn.channelTitle ?? sn.channelId,
            displayName: sn.channelTitle ?? null,
            avatarUrl: null,
            followerCount: null,
            profileUrl: `https://www.youtube.com/channel/${sn.channelId}`,
          }
        : null,
      metrics: {
        views: stats?.viewCount != null ? Number(stats.viewCount) : null,
        likes: stats?.likeCount != null ? Number(stats.likeCount) : null,
        comments:
          stats?.commentCount != null ? Number(stats.commentCount) : null,
        shares: null,
        saves: null,
        capturedAt: new Date().toISOString(),
      },
      playback: {
        kind: "embed",
        embedUrl: `https://www.youtube-nocookie.com/embed/${item.id}`,
      },
      media: { kind: "requires_upload" },
      hashtags: sn?.tags ?? [],
      language: sn?.defaultAudioLanguage ?? null,
    };
  }

  async fetchVideoMetadata(resolved: ResolvedUrl) {
    const data = await this.call<{ items?: unknown[] }>("videos", {
      part: "snippet,contentDetails,statistics",
      id: resolved.externalId,
    });
    const item = videoItemSchema.safeParse(data.items?.[0]);
    if (!item.success || !data.items?.length) {
      if (!data.items?.length)
        throw new ProviderError(
          this.id,
          "not_found",
          "Video not found or private",
        );
      throw new ProviderError(
        this.id,
        "invalid_response",
        "YouTube response failed validation",
      );
    }
    return { video: this.normalize(item.data), raw: data };
  }

  async discoverCreator(
    ref: { externalId?: string; handle?: string; url?: string },
    opts: { maxItems: number },
  ) {
    const handle = (ref.handle ?? ref.externalId ?? "").replace(/^@/, "");
    const channels = await this.call<{
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: Record<string, { url: string }>;
        };
        statistics?: { subscriberCount?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    }>("channels", {
      part: "snippet,statistics,contentDetails",
      forHandle: handle,
    });
    const ch = channels.items?.[0];
    if (!ch)
      throw new ProviderError(
        this.id,
        "not_found",
        `Channel @${handle} not found`,
      );
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads)
      throw new ProviderError(
        this.id,
        "invalid_response",
        "Channel has no uploads playlist",
      );

    const playlist = await this.call<{
      items?: Array<{ contentDetails?: { videoId?: string } }>;
    }>("playlistItems", {
      part: "contentDetails",
      playlistId: uploads,
      maxResults: String(Math.min(opts.maxItems, 50)),
    });
    const ids = (playlist.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((v): v is string => !!v);
    const videosData = ids.length
      ? await this.call<{ items?: unknown[] }>("videos", {
          part: "snippet,contentDetails,statistics",
          id: ids.join(","),
        })
      : { items: [] };
    const videos = (videosData.items ?? [])
      .map((i) => videoItemSchema.safeParse(i))
      .filter(
        (r): r is { success: true; data: z.infer<typeof videoItemSchema> } =>
          r.success,
      )
      .map((r) => this.normalize(r.data));

    return {
      creator: {
        platform: "youtube" as const,
        externalId: ch.id,
        handle: ch.snippet?.customUrl ?? `@${handle}`,
        displayName: ch.snippet?.title ?? null,
        avatarUrl: ch.snippet?.thumbnails?.["default"]?.url ?? null,
        followerCount:
          ch.statistics?.subscriberCount != null
            ? Number(ch.statistics.subscriberCount)
            : null,
        profileUrl: `https://www.youtube.com/${ch.snippet?.customUrl ?? `channel/${ch.id}`}`,
      },
      videos,
      raw: { channels, playlist, videosData },
    };
  }

  async refreshMetrics(resolved: ResolvedUrl) {
    const { video, raw } = await this.fetchVideoMetadata(resolved);
    return { metrics: video.metrics, raw };
  }

  async getRunStatus(): Promise<ProviderRunStatus> {
    throw new ProviderError(
      this.id,
      "unsupported_url",
      "YouTube adapter has no async runs",
    );
  }

  estimateCost(): ProviderCostEstimate {
    return {
      estimatedUsd: 0,
      basis: "YouTube Data API uses free quota units, not billed charges",
    };
  }
}
