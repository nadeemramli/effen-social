import "server-only";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  AssetKind,
  SignedUploadTarget,
  StorageAdapter,
} from "@effen/core";
import { env } from "@/lib/env";
import { encodeToken, isSafeStorageKey, signStorageToken } from "./signing";

const UPLOAD_URL_TTL = 15 * 60;
const READ_URL_TTL = 10 * 60;

function baseDir(): string {
  return resolve(process.cwd(), "..", "..", env().EFFEN_LOCAL_STORAGE_DIR);
}

function diskPath(key: string): string {
  if (!isSafeStorageKey(key)) throw new Error(`Unsafe storage key: ${key}`);
  return join(baseDir(), key);
}

export function makeStorageKey(
  workspaceId: string,
  kind: AssetKind,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${workspaceId}/${kind}/${crypto.randomUUID()}/${safeName}`;
}

/**
 * Filesystem-backed StorageAdapter for development. Serves the same signed-URL
 * contract as R2 via /api/local-storage; keys and expiry semantics are identical.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly id = "local" as const;

  async createSignedUpload(opts: {
    workspaceId: string;
    kind: AssetKind;
    fileName: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUploadTarget> {
    const key = makeStorageKey(opts.workspaceId, opts.kind, opts.fileName);
    const token = encodeToken(signStorageToken(key, "put", UPLOAD_URL_TTL));
    return {
      url: `/api/local-storage?token=${token}`,
      method: "PUT",
      headers: { "content-type": opts.contentType },
      key,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL * 1000).toISOString(),
      maxBytes: opts.maxBytes,
    };
  }

  async createSignedReadUrl(
    key: string,
    opts?: { expiresInSeconds?: number },
  ): Promise<string> {
    const token = encodeToken(
      signStorageToken(key, "get", opts?.expiresInSeconds ?? READ_URL_TTL),
    );
    return `/api/local-storage?token=${token}`;
  }

  async putObject(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
  ) {
    void contentType; // local disk keeps no metadata; type is re-derived from the extension on read
    const path = diskPath(key);
    await mkdir(dirname(path), { recursive: true });
    if (data instanceof Uint8Array) {
      await writeFile(path, data);
    } else {
      const chunks: Uint8Array[] = [];
      const reader = data.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      await writeFile(path, Buffer.concat(chunks));
    }
  }

  async getObject(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(diskPath(key)));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(diskPath(key), { force: true });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await stat(diskPath(key));
      return true;
    } catch {
      return false;
    }
  }
}

export function localDiskPath(key: string): string {
  return diskPath(key);
}
