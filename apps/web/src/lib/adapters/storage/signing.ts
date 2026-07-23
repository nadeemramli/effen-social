import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * HMAC token for local-storage signed URLs: sign(key | op | exp).
 * Mirrors the shape of R2 presigned URLs so product code treats both identically.
 */
export interface SignedToken {
  key: string;
  op: "put" | "get";
  exp: number; // unix seconds
  sig: string;
}

function hmac(payload: string): string {
  return createHmac("sha256", env().EFFEN_SIGNING_SECRET)
    .update(payload)
    .digest("hex");
}

export function signStorageToken(
  key: string,
  op: "put" | "get",
  expiresInSeconds: number,
): SignedToken {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return { key, op, exp, sig: hmac(`${key}|${op}|${exp}`) };
}

export function verifyStorageToken(token: SignedToken): boolean {
  if (token.exp < Math.floor(Date.now() / 1000)) return false;
  const expected = hmac(`${token.key}|${token.op}|${token.exp}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(token.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encodeToken(t: SignedToken): string {
  return Buffer.from(JSON.stringify(t)).toString("base64url");
}

export function decodeToken(raw: string): SignedToken | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString(),
    ) as SignedToken;
    if (
      typeof parsed.key === "string" &&
      (parsed.op === "put" || parsed.op === "get") &&
      typeof parsed.exp === "number" &&
      typeof parsed.sig === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Reject path traversal and absolute keys. */
export function isSafeStorageKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length < 512 &&
    !key.startsWith("/") &&
    !key.includes("..") &&
    /^[a-zA-Z0-9/_.-]+$/.test(key)
  );
}
