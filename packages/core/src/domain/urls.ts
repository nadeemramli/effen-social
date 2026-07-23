import type { Platform } from "../providers/types";

/**
 * Platform-agnostic URL classification and canonicalization used for duplicate
 * prevention. Providers own the authoritative resolution; this helper lets the web
 * tier route a pasted URL to the right provider and reject junk early.
 */

export interface ClassifiedUrl {
  platform: Platform;
  kind: "video" | "creator";
  externalId: string;
  canonicalUrl: string;
}

const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function classifyUrl(raw: string): ClassifiedUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (
    host === "youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com"
  ) {
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
    else if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (
      url.pathname.startsWith("/shorts/") ||
      url.pathname.startsWith("/embed/")
    )
      id = url.pathname.split("/")[2] ?? null;
    if (id && YT_VIDEO_ID.test(id)) {
      return {
        platform: "youtube",
        kind: "video",
        externalId: id,
        canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      };
    }
    const ch = url.pathname.match(/^\/(@[A-Za-z0-9._-]{2,31})/);
    if (ch?.[1]) {
      return {
        platform: "youtube",
        kind: "creator",
        externalId: ch[1],
        canonicalUrl: `https://www.youtube.com/${ch[1]}`,
      };
    }
    return null;
  }

  if (host === "instagram.com" || host === "instagr.am") {
    const media = url.pathname.match(
      /^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/,
    );
    if (media?.[1]) {
      return {
        platform: "instagram",
        kind: "video",
        externalId: media[1],
        canonicalUrl: `https://www.instagram.com/reel/${media[1]}/`,
      };
    }
    const profile = url.pathname.match(/^\/([A-Za-z0-9._]{2,30})\/?$/);
    if (
      profile?.[1] &&
      !["explore", "accounts", "about"].includes(profile[1])
    ) {
      return {
        platform: "instagram",
        kind: "creator",
        externalId: profile[1].toLowerCase(),
        canonicalUrl: `https://www.instagram.com/${profile[1].toLowerCase()}/`,
      };
    }
    return null;
  }

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const video = url.pathname.match(/^\/(@[A-Za-z0-9._]{2,24})\/video\/(\d+)/);
    if (video?.[1] && video[2]) {
      return {
        platform: "tiktok",
        kind: "video",
        externalId: video[2],
        canonicalUrl: `https://www.tiktok.com/${video[1]}/video/${video[2]}`,
      };
    }
    const profile = url.pathname.match(/^\/(@[A-Za-z0-9._]{2,24})\/?$/);
    if (profile?.[1]) {
      return {
        platform: "tiktok",
        kind: "creator",
        externalId: profile[1].slice(1).toLowerCase(),
        canonicalUrl: `https://www.tiktok.com/@${profile[1].slice(1).toLowerCase()}`,
      };
    }
    // Short links (vm.tiktok.com/xyz) need server-side resolution by the provider.
    return null;
  }

  return null;
}
