import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MEDIA_LIMITS } from "@effen/core";
import { PermanentJobError } from "./db";

/**
 * SSRF-safe media download: https only, public IPs only (checked per hop),
 * bounded redirects, bounded size. Used for provider-supplied direct media
 * URLs — never for user-controlled arbitrary fetching.
 */

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("::ffff:127.") ||
      lower.startsWith("::ffff:10.") ||
      lower.startsWith("::ffff:192.168.")
    );
  }
  const parts = ip.split(".").map(Number);
  const [a, b] = [parts[0] ?? 0, parts[1] ?? 0];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "https:")
    throw new PermanentJobError("Media URLs must use https");
  const host = url.hostname;
  const ips = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  for (const { address } of ips) {
    if (isPrivateIp(address))
      throw new PermanentJobError(
        `Refusing to fetch from non-public address (${address})`,
      );
  }
}

export async function safeDownload(
  rawUrl: string,
  maxBytes = MEDIA_LIMITS.maxUploadBytes,
): Promise<Uint8Array> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirect without location (${res.status})`);
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes)
      throw new PermanentJobError(
        `Media exceeds the ${Math.round(maxBytes / 1e6)}MB limit`,
      );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Empty response body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PermanentJobError(
          `Media exceeds the ${Math.round(maxBytes / 1e6)}MB limit`,
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new PermanentJobError("Too many redirects");
}
