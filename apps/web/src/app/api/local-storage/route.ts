import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { MEDIA_LIMITS } from "@effen/core";
import {
  decodeToken,
  isSafeStorageKey,
  verifyStorageToken,
} from "@/lib/adapters/storage/signing";
import {
  LocalStorageAdapter,
  localDiskPath,
} from "@/lib/adapters/storage/local";

/**
 * Dev-mode object store endpoint. Access is only via short-lived HMAC tokens —
 * mirrors R2 presigned-URL behavior. Not used when EFFEN_STORAGE=r2.
 */

function authorized(req: NextRequest, op: "put" | "get") {
  const raw = req.nextUrl.searchParams.get("token");
  if (!raw) return null;
  const token = decodeToken(raw);
  if (
    !token ||
    token.op !== op ||
    !verifyStorageToken(token) ||
    !isSafeStorageKey(token.key)
  ) {
    return null;
  }
  return token;
}

export async function PUT(req: NextRequest) {
  const token = authorized(req, "put");
  if (!token)
    return NextResponse.json(
      { error: "Invalid or expired upload URL" },
      { status: 403 },
    );

  const len = Number(req.headers.get("content-length") ?? "0");
  if (!len || len > MEDIA_LIMITS.maxUploadBytes) {
    return NextResponse.json(
      {
        error: `Upload must be 1 byte to ${MEDIA_LIMITS.maxUploadBytes} bytes`,
      },
      { status: 413 },
    );
  }
  if (!req.body)
    return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const adapter = new LocalStorageAdapter();
  await adapter.putObject(
    token.key,
    req.body as ReadableStream<Uint8Array>,
    req.headers.get("content-type") ?? "application/octet-stream",
  );
  return NextResponse.json({ ok: true, key: token.key });
}

export async function GET(req: NextRequest) {
  const token = authorized(req, "get");
  if (!token)
    return NextResponse.json(
      { error: "Invalid or expired URL" },
      { status: 403 },
    );

  const path = localDiskPath(token.key);
  try {
    const info = await stat(path);
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    const ext = token.key.split(".").pop()?.toLowerCase() ?? "";
    const type =
      {
        mp4: "video/mp4",
        webm: "video/webm",
        mov: "video/quicktime",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        wav: "audio/wav",
        txt: "text/plain",
        md: "text/markdown",
      }[ext] ?? "application/octet-stream";
    return new NextResponse(stream, {
      headers: {
        "content-type": type,
        "content-length": String(info.size),
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Object not found" }, { status: 404 });
  }
}
