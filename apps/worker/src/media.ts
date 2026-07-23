import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { MEDIA_LIMITS } from "@effen/core";
import { PermanentJobError } from "./db";

const exec = promisify(execFile);

export interface ProbeResult {
  container: string;
  durationSeconds: number;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number;
}

/** ffprobe-based validation. Throws PermanentJobError when media is out of policy. */
export async function probe(path: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]));
  } catch {
    throw new PermanentJobError("File is not a readable media container");
  }
  const data = JSON.parse(stdout) as {
    format?: { format_name?: string; duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const fpsRaw = video?.avg_frame_rate ?? "0/1";
  const [num, den] = fpsRaw.split("/").map(Number);
  const result: ProbeResult = {
    container: data.format?.format_name ?? "unknown",
    durationSeconds: Number(data.format?.duration ?? 0),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: den && num ? num / den : null,
    bytes: Number(data.format?.size ?? 0),
  };

  const L = MEDIA_LIMITS;
  if (
    !L.allowedContainers.some(
      (c) =>
        result.container.includes(c.split(",")[0]!) || c === result.container,
    )
  ) {
    throw new PermanentJobError(
      `Container "${result.container}" is not supported`,
    );
  }
  if (
    !result.videoCodec ||
    !(L.allowedVideoCodecs as readonly string[]).includes(result.videoCodec)
  ) {
    throw new PermanentJobError(
      `Video codec "${result.videoCodec ?? "none"}" is not supported`,
    );
  }
  if (
    result.audioCodec &&
    !(L.allowedAudioCodecs as readonly string[]).includes(result.audioCodec)
  ) {
    throw new PermanentJobError(
      `Audio codec "${result.audioCodec}" is not supported`,
    );
  }
  if (
    result.durationSeconds < L.minDurationSeconds ||
    result.durationSeconds > L.maxDurationSeconds
  ) {
    throw new PermanentJobError(
      `Duration ${Math.round(result.durationSeconds)}s is outside the allowed 1s–${L.maxDurationSeconds / 60}min range`,
    );
  }
  if ((result.width ?? 0) > L.maxWidth || (result.height ?? 0) > L.maxHeight) {
    throw new PermanentJobError(
      `Resolution ${result.width}x${result.height} exceeds ${L.maxWidth}x${L.maxHeight}`,
    );
  }
  if ((result.fps ?? 0) > L.maxFps) {
    throw new PermanentJobError(
      `Frame rate ${result.fps?.toFixed(0)} exceeds ${L.maxFps} fps`,
    );
  }
  return result;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export interface NormalizedOutputs {
  proxyPath: string | null; // null when the original is already compliant
  audioPath: string;
  posterPath: string;
  framePaths: Array<{ path: string; timeSeconds: number }>;
}

/** Produce proxy (<=720p h264/aac), mono 16k wav, poster, and scene frames. */
export async function normalizeMedia(
  originalPath: string,
  workDir: string,
  probeResult: ProbeResult,
): Promise<NormalizedOutputs> {
  await mkdir(workDir, { recursive: true });
  const needsProxy =
    probeResult.videoCodec !== "h264" ||
    (probeResult.audioCodec != null && probeResult.audioCodec !== "aac") ||
    (probeResult.height ?? 0) > MEDIA_LIMITS.proxyMaxHeight;

  let proxyPath: string | null = null;
  if (needsProxy) {
    proxyPath = join(workDir, "proxy.mp4");
    await exec(
      "ffmpeg",
      [
        "-y",
        "-i",
        originalPath,
        "-vf",
        `scale=-2:'min(${MEDIA_LIMITS.proxyMaxHeight},ih)'`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        proxyPath,
      ],
      { timeout: 10 * 60_000 },
    );
  }

  const audioPath = join(workDir, "audio.wav");
  if (probeResult.audioCodec) {
    await exec(
      "ffmpeg",
      [
        "-y",
        "-i",
        originalPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(MEDIA_LIMITS.audioSampleRate),
        audioPath,
      ],
      { timeout: 5 * 60_000 },
    );
  } else {
    // No audio stream: emit 1s of silence so downstream steps have a valid file.
    await exec(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=${MEDIA_LIMITS.audioSampleRate}:cl=mono`,
        "-t",
        "1",
        audioPath,
      ],
      { timeout: 60_000 },
    );
  }

  const posterPath = join(workDir, "poster.jpg");
  await exec(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(Math.min(1, probeResult.durationSeconds / 2)),
      "-i",
      originalPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      posterPath,
    ],
    { timeout: 60_000 },
  );

  // Representative frames spread across the duration (scene detection can miss
  // on talking-head clips, so evenly spaced sampling is the reliable default).
  const frameCount = Math.min(
    MEDIA_LIMITS.sceneFrameCount,
    Math.max(2, Math.floor(probeResult.durationSeconds / 5)),
  );
  const framePaths: Array<{ path: string; timeSeconds: number }> = [];
  for (let i = 0; i < frameCount; i++) {
    const t = ((i + 0.5) / frameCount) * probeResult.durationSeconds;
    const p = join(workDir, `frame-${String(i).padStart(2, "0")}.jpg`);
    await exec(
      "ffmpeg",
      [
        "-y",
        "-ss",
        t.toFixed(2),
        "-i",
        originalPath,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        "-vf",
        "scale=-2:480",
        p,
      ],
      { timeout: 60_000 },
    );
    framePaths.push({ path: p, timeSeconds: Math.round(t * 10) / 10 });
  }

  return { proxyPath, audioPath, posterPath, framePaths };
}

export async function cleanupDir(dir: string): Promise<void> {
  try {
    await readdir(dir);
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}
