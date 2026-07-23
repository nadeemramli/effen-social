import "server-only";
import {
  ProviderError,
  type IngestionProvider,
  type Platform,
} from "@effen/core";
import { isMockMode } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { MockIngestionProvider } from "./mock";
import { YouTubeOfficialProvider } from "./youtube";
import { ApifyProvider } from "./apify";

const PROVIDER_ID_BY_PLATFORM = {
  youtube: "youtube_official",
  instagram: "instagram_apify",
  tiktok: "tiktok_apify",
  upload: "manual_upload",
} as const;

/**
 * Resolve the ingestion provider for a platform, honoring mock mode and the
 * workspace's provider enable/disable switches. Throws typed ProviderError so
 * callers can surface actionable messages.
 */
export async function providerFor(
  platform: Platform,
  workspaceId: string,
): Promise<IngestionProvider> {
  const providerId = PROVIDER_ID_BY_PLATFORM[platform];
  if (platform === "upload") {
    throw new ProviderError(
      providerId,
      "unsupported_url",
      "Uploads do not use an ingestion provider",
    );
  }

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("workspace_settings")
    .select("providers_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const enabled = (data?.providers_enabled ?? {}) as Record<string, boolean>;
  if (enabled[providerId] === false) {
    throw new ProviderError(
      providerId,
      "policy",
      `${platform} ingestion is disabled in Settings. Enable it there, or use direct upload / original link instead.`,
      false,
    );
  }

  if (isMockMode()) {
    // EFFEN_MOCK_OUTAGE="tiktok,instagram" simulates provider outages for failure-path testing.
    const outages = (process.env.EFFEN_MOCK_OUTAGE ?? "")
      .split(",")
      .map((s) => s.trim());
    return new MockIngestionProvider(
      providerId,
      platform,
      outages.includes(platform),
    );
  }

  if (platform === "youtube") return new YouTubeOfficialProvider();
  return new ApifyProvider(providerId, platform);
}
