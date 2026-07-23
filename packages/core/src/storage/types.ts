/**
 * Storage abstraction. R2 in production, local filesystem in development.
 * All browser access goes through short-lived signed URLs — never raw keys.
 */

export type AssetKind =
  "original" | "proxy" | "audio" | "poster" | "frame" | "export";

export interface SignedUploadTarget {
  /** URL the browser PUTs the file to. */
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  key: string;
  expiresAt: string;
  maxBytes: number;
}

export interface StorageAdapter {
  readonly id: "r2" | "local";
  createSignedUpload(opts: {
    workspaceId: string;
    kind: AssetKind;
    fileName: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUploadTarget>;
  createSignedReadUrl(
    key: string,
    opts?: { expiresInSeconds?: number },
  ): Promise<string>;
  putObject(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
  ): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
}

/** Media validation limits enforced by the worker before any processing. */
export const MEDIA_LIMITS = {
  maxUploadBytes: 500 * 1024 * 1024,
  maxDurationSeconds: 15 * 60,
  minDurationSeconds: 1,
  maxWidth: 4096,
  maxHeight: 4096,
  maxFps: 120,
  allowedContainers: ["mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"],
  allowedVideoCodecs: ["h264", "hevc", "vp8", "vp9", "av1"],
  allowedAudioCodecs: ["aac", "mp3", "opus", "vorbis", "pcm_s16le"],
  allowedUploadMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
  proxyMaxHeight: 720,
  audioSampleRate: 16000,
  sceneFrameCount: 6,
} as const;
