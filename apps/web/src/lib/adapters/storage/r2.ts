import "server-only";
import type {
  AssetKind,
  SignedUploadTarget,
  StorageAdapter,
} from "@effen/core";
import { env } from "@/lib/env";
import { makeStorageKey } from "./local";

/**
 * Cloudflare R2 via the S3-compatible API with SigV4 presigning (no SDK
 * dependency). Activated with EFFEN_STORAGE=r2; requires R2_* env vars.
 */
export class R2StorageAdapter implements StorageAdapter {
  readonly id = "r2" as const;

  private get endpoint(): string {
    return `https://${env().R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }

  private async presign(
    method: "GET" | "PUT" | "DELETE" | "HEAD",
    key: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env();
    const host = `${env().R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const region = "auto";
    const service = "s3";
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const canonicalUri = `/${R2_BUCKET}/${encodedKey}`;

    const params = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${R2_ACCESS_KEY_ID}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresInSeconds),
      "X-Amz-SignedHeaders": "host",
    });
    const canonicalQuery = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const encoder = new TextEncoder();
    const sha256 = async (data: string | Uint8Array) => {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        typeof data === "string"
          ? encoder.encode(data)
          : (data as Uint8Array<ArrayBuffer>),
      );
      return [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };
    const hmac = async (keyData: Uint8Array, data: string) => {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData as Uint8Array<ArrayBuffer>,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      return new Uint8Array(
        await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)),
      );
    };

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await sha256(canonicalRequest),
    ].join("\n");
    let signingKey = await hmac(
      encoder.encode(`AWS4${R2_SECRET_ACCESS_KEY}`),
      dateStamp,
    );
    signingKey = await hmac(signingKey, region);
    signingKey = await hmac(signingKey, service);
    signingKey = await hmac(signingKey, "aws4_request");
    const signature = [...(await hmac(signingKey, stringToSign))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return `${this.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  async createSignedUpload(opts: {
    workspaceId: string;
    kind: AssetKind;
    fileName: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUploadTarget> {
    const key = makeStorageKey(opts.workspaceId, opts.kind, opts.fileName);
    const url = await this.presign("PUT", key, 900);
    return {
      url,
      method: "PUT",
      headers: { "content-type": opts.contentType },
      key,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      maxBytes: opts.maxBytes,
    };
  }

  async createSignedReadUrl(
    key: string,
    opts?: { expiresInSeconds?: number },
  ): Promise<string> {
    return this.presign("GET", key, opts?.expiresInSeconds ?? 600);
  }

  async putObject(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
  ) {
    const url = await this.presign("PUT", key, 300);
    const body =
      data instanceof Uint8Array
        ? (data as Uint8Array<ArrayBuffer>)
        : await new Response(data).arrayBuffer();
    const res = await fetch(url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });
    if (!res.ok) throw new Error(`R2 put failed: ${res.status}`);
  }

  async getObject(key: string): Promise<Uint8Array> {
    const url = await this.presign("GET", key, 300);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`R2 get failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const url = await this.presign("DELETE", key, 300);
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404)
      throw new Error(`R2 delete failed: ${res.status}`);
  }

  async objectExists(key: string): Promise<boolean> {
    const url = await this.presign("HEAD", key, 300);
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  }
}
