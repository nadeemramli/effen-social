import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ANALYSIS_SCHEMA_VERSION,
  analysisV1Schema,
  mockAnalysis,
  type JobPayload,
} from "@effen/core";
import {
  db,
  enqueue,
  getVideo,
  PermanentJobError,
  setVideoError,
  transition,
} from "./db";
import { env, storageDir } from "./env";
import { cleanupDir, normalizeMedia, probe, sha256File } from "./media";
import { safeDownload } from "./fetch-safe";

const ANALYSIS_PROMPT_VERSION = "analysis.v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function diskPath(key: string): string {
  if (key.startsWith("/") || key.includes(".."))
    throw new PermanentJobError(`Unsafe storage key ${key}`);
  return join(storageDir, key);
}

async function putFile(localPath: string, key: string): Promise<number> {
  const dest = diskPath(key);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(localPath, dest);
  return (await stat(dest)).size;
}

async function addAsset(opts: {
  videoId: string;
  workspaceId: string;
  kind: string;
  key: string;
  contentType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  frameTimeSeconds?: number | null;
}) {
  const { error } = await db.from("media_assets").upsert(
    {
      video_id: opts.videoId,
      workspace_id: opts.workspaceId,
      kind: opts.kind,
      storage_key: opts.key,
      content_type: opts.contentType,
      bytes: opts.bytes,
      width: opts.width ?? null,
      height: opts.height ?? null,
      duration_seconds: opts.durationSeconds ?? null,
      frame_time_seconds: opts.frameTimeSeconds ?? null,
    },
    { onConflict: "storage_key" },
  );
  if (error) throw new Error(`asset insert failed: ${error.message}`);
}

async function recordRun(opts: {
  workspaceId: string;
  operation: string;
  promptTemplate: string;
  videoId?: string;
  latencyMs: number;
  status?: "succeeded" | "failed";
  error?: string;
  mediaSeconds?: number | null;
  cached?: boolean;
}) {
  await db.from("ai_runs").insert({
    workspace_id: opts.workspaceId,
    operation: opts.operation,
    provider: env.EFFEN_MODE === "mock" ? "mock" : "unconfigured",
    model:
      env.EFFEN_MODE === "mock" ? `mock:${opts.operation}` : "unconfigured",
    prompt_template: opts.promptTemplate,
    prompt_version: ANALYSIS_PROMPT_VERSION,
    output_schema_version: ANALYSIS_SCHEMA_VERSION,
    media_seconds: opts.mediaSeconds ?? null,
    estimated_cost_usd: 0, // mock mode spends nothing; live adapters report real numbers
    latency_ms: opts.latencyMs,
    status: opts.status ?? "succeeded",
    error: opts.error ?? null,
    safety_flags: opts.cached ? ["cache_hit"] : [],
    video_id: opts.videoId ?? null,
  });
}

/* -------------------------------------------------------------- handlers */

export async function handleAcquireMedia(payload: JobPayload): Promise<void> {
  const { workspaceId, videoId } = payload;
  if (!videoId) throw new PermanentJobError("acquire_media requires videoId");
  const video = await getVideo(videoId, workspaceId);

  if (video.status === "selected_for_analysis") {
    await transition(videoId, workspaceId, "acquiring_media", "Locating media");
  } else if (video.status !== "acquiring_media") {
    // Replay of an already-advanced job: nothing to do.
    if (
      [
        "normalizing",
        "transcribing",
        "analyzing",
        "generating_ideas",
        "complete",
      ].includes(video.status)
    )
      return;
    throw new PermanentJobError(
      `Unexpected status ${video.status} for acquire_media`,
    );
  }

  if (video.origin === "upload") {
    const { data: original } = await db
      .from("media_assets")
      .select("storage_key")
      .eq("video_id", videoId)
      .eq("kind", "original")
      .maybeSingle();
    if (!original) {
      await transition(
        videoId,
        workspaceId,
        "media_unavailable",
        "Uploaded file is missing from storage",
      );
      return;
    }
    try {
      await stat(diskPath(original.storage_key));
    } catch {
      await transition(
        videoId,
        workspaceId,
        "media_unavailable",
        "Uploaded file is missing from storage",
      );
      return;
    }
  } else {
    // URL-sourced video. If a provider supplied a direct media URL it would be
    // downloaded here (SSRF-safe); otherwise analysis proceeds without local
    // media (direct-URL video understanding / embed playback).
    const directUrl = (video as { media_direct_url?: string }).media_direct_url;
    if (directUrl) {
      const bytes = await safeDownload(directUrl);
      const key = `${workspaceId}/original/${videoId}/source.mp4`;
      const dest = diskPath(key);
      await mkdir(dirname(dest), { recursive: true });
      await (await import("node:fs/promises")).writeFile(dest, bytes);
      await addAsset({
        videoId,
        workspaceId,
        kind: "original",
        key,
        contentType: "video/mp4",
        bytes: bytes.byteLength,
      });
    }
  }

  await sleep(env.WORKER_STEP_DELAY_MS);
  await transition(
    videoId,
    workspaceId,
    "normalizing",
    "Validating and normalizing media",
  );
  await enqueue(
    "normalize_media",
    { workspaceId, videoId, params: payload.params },
    `normalize_media:${videoId}`,
  );
}

export async function handleNormalizeMedia(payload: JobPayload): Promise<void> {
  const { workspaceId, videoId } = payload;
  if (!videoId) throw new PermanentJobError("normalize_media requires videoId");
  const video = await getVideo(videoId, workspaceId);
  if (
    ["transcribing", "analyzing", "generating_ideas", "complete"].includes(
      video.status,
    )
  )
    return;

  const { data: original } = await db
    .from("media_assets")
    .select("storage_key, content_type")
    .eq("video_id", videoId)
    .eq("kind", "original")
    .maybeSingle();

  if (original) {
    const originalPath = diskPath(original.storage_key);
    const work = join(tmpdir(), `effen-${videoId}`);
    try {
      const probed = await probe(originalPath);
      const checksum = await sha256File(originalPath);

      // Duplicate-content guard: same checksum on another video in this workspace.
      const { data: dupe } = await db
        .from("videos")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("media_checksum", checksum)
        .neq("id", videoId)
        .maybeSingle();
      if (dupe) {
        await transition(
          videoId,
          workspaceId,
          "failed_permanent",
          `Duplicate of an existing video (${dupe.id}) — identical file content`,
        );
        await setVideoError(
          videoId,
          workspaceId,
          "This exact file already exists in your library.",
        );
        return;
      }

      const outputs = await normalizeMedia(originalPath, work, probed);

      await db
        .from("videos")
        .update({
          media_checksum: checksum,
          duration_seconds: probed.durationSeconds,
        })
        .eq("id", videoId)
        .eq("workspace_id", workspaceId);

      if (outputs.proxyPath) {
        const key = `${workspaceId}/proxy/${videoId}/proxy.mp4`;
        const bytes = await putFile(outputs.proxyPath, key);
        await addAsset({
          videoId,
          workspaceId,
          kind: "proxy",
          key,
          contentType: "video/mp4",
          bytes,
          durationSeconds: probed.durationSeconds,
        });
      }
      const audioKey = `${workspaceId}/audio/${videoId}/audio.wav`;
      const audioBytes = await putFile(outputs.audioPath, audioKey);
      await addAsset({
        videoId,
        workspaceId,
        kind: "audio",
        key: audioKey,
        contentType: "audio/wav",
        bytes: audioBytes,
      });

      const posterKey = `${workspaceId}/poster/${videoId}/poster.jpg`;
      const posterBytes = await putFile(outputs.posterPath, posterKey);
      await addAsset({
        videoId,
        workspaceId,
        kind: "poster",
        key: posterKey,
        contentType: "image/jpeg",
        bytes: posterBytes,
      });

      for (const frame of outputs.framePaths) {
        const key = `${workspaceId}/frame/${videoId}/${frame.timeSeconds.toFixed(1)}.jpg`;
        const bytes = await putFile(frame.path, key);
        await addAsset({
          videoId,
          workspaceId,
          kind: "frame",
          key,
          contentType: "image/jpeg",
          bytes,
          frameTimeSeconds: frame.timeSeconds,
        });
      }
    } finally {
      await cleanupDir(work);
    }
  } else {
    // No local media (URL-only video): normalization is a validated no-op.
    await sleep(env.WORKER_STEP_DELAY_MS);
  }

  await transition(videoId, workspaceId, "transcribing", "Transcribing audio");
  await enqueue(
    "transcribe",
    { workspaceId, videoId, params: payload.params },
    `transcribe:${videoId}`,
  );
}

export async function handleTranscribe(payload: JobPayload): Promise<void> {
  const { workspaceId, videoId } = payload;
  if (!videoId) throw new PermanentJobError("transcribe requires videoId");
  const video = await getVideo(videoId, workspaceId);
  if (["analyzing", "generating_ideas", "complete"].includes(video.status))
    return;

  if (env.EFFEN_MODE !== "mock") {
    throw new Error(
      "Live transcription is not configured. Set EFFEN_MODE=mock, or provide OPENAI_API_KEY and implement-check the live adapter (docs/DECISIONS.md).",
    );
  }
  const started = Date.now();
  await sleep(env.WORKER_STEP_DELAY_MS);
  await recordRun({
    workspaceId,
    videoId,
    operation: "transcription",
    promptTemplate: "transcription.v1",
    latencyMs: Date.now() - started,
    mediaSeconds: Number(video.duration_seconds ?? 0),
  });
  await transition(
    videoId,
    workspaceId,
    "analyzing",
    "Running structured analysis",
  );
  await enqueue(
    "analyze",
    { workspaceId, videoId, params: payload.params },
    `analyze:${videoId}`,
  );
}

export async function handleAnalyze(payload: JobPayload): Promise<void> {
  const { workspaceId, videoId } = payload;
  if (!videoId) throw new PermanentJobError("analyze requires videoId");
  const video = await getVideo(videoId, workspaceId);
  if (["generating_ideas", "complete"].includes(video.status)) return;

  if (env.EFFEN_MODE !== "mock") {
    throw new Error(
      "Live video understanding is not configured. Set EFFEN_MODE=mock, or provide GEMINI_API_KEY and enable the live adapter (docs/DECISIONS.md).",
    );
  }

  const started = Date.now();
  const checksum: string | null = video.media_checksum;
  const force = Boolean(
    (payload.params as { force?: boolean } | undefined)?.force,
  );

  // Analysis cache: identical content + prompt version -> reuse, never re-spend.
  // A user-requested regeneration (force) bypasses the cache deliberately.
  let content: unknown = null;
  let cached = false;
  if (checksum && !force) {
    const { data: hit } = await db
      .from("analyses")
      .select("content")
      .eq("workspace_id", workspaceId)
      .eq("media_checksum", checksum)
      .eq("prompt_version", ANALYSIS_PROMPT_VERSION)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (hit) {
      content = hit.content;
      cached = true;
    }
  }

  const { data: latestForSeed } = await db
    .from("analyses")
    .select("version")
    .eq("video_id", videoId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!content) {
    await sleep(env.WORKER_STEP_DELAY_MS * 2);
    const { data: snapshot } = await db
      .from("video_metrics_snapshots")
      .select("views, likes, comments")
      .eq("video_id", videoId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    content = mockAnalysis({
      // Regenerations vary the seed so a new version is genuinely different.
      seed: `${checksum ?? videoId}${force ? `:v${(latestForSeed?.version ?? 0) + 1}` : ""}`,
      durationSeconds: Number(video.duration_seconds ?? 45),
      title: video.title,
      metrics: snapshot ?? null,
    });
  }

  const parsed = analysisV1Schema.safeParse(content);
  if (!parsed.success) {
    throw new Error(
      `Analysis output failed schema validation: ${parsed.error.issues[0]?.message}`,
    );
  }

  // Default persona (if any) is recorded so regenerations are traceable.
  const { data: persona } = await db
    .from("personas")
    .select("id, current_version")
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const version = (latestForSeed?.version ?? 0) + 1;

  const { error: insertError } = await db.from("analyses").insert({
    video_id: videoId,
    workspace_id: workspaceId,
    version,
    schema_version: ANALYSIS_SCHEMA_VERSION,
    prompt_version: ANALYSIS_PROMPT_VERSION,
    persona_id: persona?.id ?? null,
    persona_version: persona?.current_version ?? null,
    media_checksum: checksum,
    content: parsed.data,
    model: cached ? "cache" : "mock:gemini-2.5-flash",
    provider: cached ? "cache" : "mock",
  });
  if (insertError)
    throw new Error(`analysis insert failed: ${insertError.message}`);

  await recordRun({
    workspaceId,
    videoId,
    operation: "video_understanding",
    promptTemplate: "analysis.v1",
    latencyMs: Date.now() - started,
    mediaSeconds: Number(video.duration_seconds ?? 0),
    cached,
  });

  await transition(
    videoId,
    workspaceId,
    "generating_ideas",
    cached
      ? "Reusing cached analysis — generating ideas"
      : "Generating idea candidates",
  );
  await enqueue(
    "generate_ideas",
    { workspaceId, videoId, params: { analysisVersion: version } },
    `generate_ideas:${videoId}:${version}`,
  );
}

export async function handleGenerateIdeas(payload: JobPayload): Promise<void> {
  const { workspaceId, videoId } = payload;
  if (!videoId) throw new PermanentJobError("generate_ideas requires videoId");
  const video = await getVideo(videoId, workspaceId);
  if (video.status === "complete") return;

  const version =
    Number(
      (payload.params as { analysisVersion?: number } | undefined)
        ?.analysisVersion ?? 0,
    ) || undefined;
  const query = db
    .from("analyses")
    .select("id, version, content")
    .eq("video_id", videoId)
    .order("version", { ascending: false })
    .limit(1);
  const { data: analysis } = version
    ? await db
        .from("analyses")
        .select("id, version, content")
        .eq("video_id", videoId)
        .eq("version", version)
        .maybeSingle()
    : await query.maybeSingle();
  if (!analysis)
    throw new PermanentJobError("Analysis row missing for idea generation");

  const parsed = analysisV1Schema.parse(analysis.content);
  const started = Date.now();
  await sleep(env.WORKER_STEP_DELAY_MS);

  for (const idea of parsed.ideaCandidates) {
    // Idempotent replay: skip identical titles for the same analysis.
    const { data: existing } = await db
      .from("ideas")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("analysis_id", analysis.id)
      .eq("title", idea.title)
      .maybeSingle();
    if (existing) continue;
    await db.from("ideas").insert({
      workspace_id: workspaceId,
      video_id: videoId,
      analysis_id: analysis.id,
      title: idea.title,
      angle: idea.angle,
      status: "inbox",
      storytelling_format: idea.storytellingFormat,
      persona_relevance: idea.personaRelevance,
      originality_rationale: idea.originalityRationale,
      evidence: idea.evidence,
      copying_risk: idea.copyingRisk,
      copying_risk_note: idea.copyingRiskNote,
    });
  }

  await recordRun({
    workspaceId,
    videoId,
    operation: "idea_generation",
    promptTemplate: "ideas.v1",
    latencyMs: Date.now() - started,
  });
  await transition(videoId, workspaceId, "complete", "Analysis complete");
}

export async function handleRetentionCleanup(
  payload: JobPayload,
): Promise<void> {
  const { workspaceId } = payload;
  const { data: settings } = await db
    .from("workspace_settings")
    .select("raw_media_retention_days")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const days = settings?.raw_media_retention_days ?? 30;
  if (days === 0) return; // 0 = keep forever
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: stale } = await db
    .from("media_assets")
    .select("id, storage_key")
    .eq("workspace_id", workspaceId)
    .eq("kind", "original")
    .lt("created_at", cutoff);
  for (const asset of stale ?? []) {
    try {
      await (
        await import("node:fs/promises")
      ).rm(diskPath(asset.storage_key), { force: true });
      await db.from("media_assets").delete().eq("id", asset.id);
    } catch (e) {
      console.warn(
        `[worker] retention cleanup failed for ${asset.storage_key}:`,
        e,
      );
    }
  }
}
