"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ACTIVE_STATUSES,
  pipelineProgress,
  RETRYABLE_STATUSES,
  STATUS_LABELS,
  type AnalysisV1,
  type PipelineStatus,
} from "@effen/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyzeVideos,
  cancelVideo,
  refreshMetrics,
  retryVideo,
} from "../actions";
import {
  regenerateAnalysis,
  saveAnalysisNotes,
  saveHookFromAnalysis,
} from "./actions";

interface VideoInfo {
  id: string;
  title: string | null;
  caption: string | null;
  platform: string;
  origin: string;
  status: PipelineStatus;
  statusDetail: string | null;
  lastError: string | null;
  canonicalUrl: string | null;
  embedUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  checksum: string | null;
}

interface AnalysisRecord {
  id: string;
  version: number;
  createdAt: string;
  provider: string;
  model: string;
  content: AnalysisV1;
}

const fmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function tc(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function VideoDetail(props: {
  video: VideoInfo;
  mediaUrl: string | null;
  posterUrl: string | null;
  frames: Array<{ url: string; timeSeconds: number }>;
  analyses: AnalysisRecord[];
  notes: string;
  events: Array<{
    from_status: string | null;
    to_status: string;
    detail: string | null;
    created_at: string;
  }>;
  snapshots: Array<{
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    captured_at: string;
  }>;
  ideas: Array<{ id: string; title: string; status: string }>;
}) {
  const { video } = props;
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [embedStart, setEmbedStart] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(
    props.analyses[0]?.version ?? 0,
  );
  const [notes, setNotes] = useState(props.notes);
  const [notesDirty, setNotesDirty] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [pending, startTransition] = useTransition();

  const active =
    (ACTIVE_STATUSES as readonly string[]).includes(video.status) ||
    video.status === "selected_for_analysis";

  // Poll while the pipeline is working so progress stays live.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [active, router]);

  const analysis =
    props.analyses.find((a) => a.version === selectedVersion) ??
    props.analyses[0];
  const latest = props.snapshots[0];
  const progress = pipelineProgress(video.status);

  function seek(seconds: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      void videoRef.current.play().catch(() => undefined);
    } else if (video.embedUrl) {
      setEmbedStart(Math.floor(seconds));
    }
  }

  function act(
    fn: () => Promise<{ ok: boolean; error?: string; blocked?: string }>,
    okMsg: string,
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(okMsg);
      else if (res.blocked)
        toast.error("Blocked by budget", { description: res.blocked });
      else toast.error(res.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  const canSeek = Boolean(props.mediaUrl || video.embedUrl);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">
            {video.title ?? "Untitled video"}
          </h1>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="capitalize">
              {video.platform}
            </Badge>
            {video.durationSeconds != null && (
              <span className="timecode">{tc(video.durationSeconds)}</span>
            )}
            {video.publishedAt && (
              <span>
                Published {new Date(video.publishedAt).toLocaleDateString()}
              </span>
            )}
            {latest?.views != null && (
              <span>{fmt.format(latest.views)} views</span>
            )}
            {video.canonicalUrl && (
              <a
                href={video.canonicalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                Original ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {video.status === "metadata_ready" && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await analyzeVideos([video.id]);
                  return r.blocked
                    ? { ok: false, blocked: r.blocked.detail }
                    : { ok: r.ok, error: r.error };
                }, "Analysis started")
              }
            >
              Analyze this video
            </Button>
          )}
          {(RETRYABLE_STATUSES as readonly string[]).includes(video.status) && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => act(() => retryVideo(video.id), "Retry queued")}
            >
              Retry
            </Button>
          )}
          {active && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => act(() => cancelVideo(video.id), "Cancelled")}
            >
              Cancel processing
            </Button>
          )}
          {video.status === "complete" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmRegen(true)}
            >
              Regenerate analysis
            </Button>
          )}
          {video.platform !== "upload" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(() => refreshMetrics(video.id), "Metrics refreshed")
              }
            >
              Refresh metrics
            </Button>
          )}
        </div>
      </div>

      {active && (
        <Card className="mt-4">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <span className="tally-dot tally-dot--live" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {STATUS_LABELS[video.status]}
                </p>
                {video.statusDetail && (
                  <p className="text-muted-foreground text-xs">
                    {video.statusDetail}
                  </p>
                )}
              </div>
            </div>
            {progress != null && (
              <Progress
                className="mt-3"
                value={progress * 100}
                aria-label="Pipeline progress"
              />
            )}
            <p className="text-muted-foreground mt-2 text-xs">
              Media prep, transcription, analysis, and idea generation run as
              separate retryable steps. You can leave this page.
            </p>
          </CardContent>
        </Card>
      )}

      {(video.status === "failed_retryable" ||
        video.status === "media_unavailable" ||
        video.status === "budget_blocked") && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>{STATUS_LABELS[video.status]}</AlertTitle>
          <AlertDescription>
            {video.lastError ??
              video.statusDetail ??
              "The last step did not finish."}{" "}
            {video.status === "budget_blocked" && (
              <>
                Adjust limits in{" "}
                <Link href="/settings" className="underline">
                  Usage &amp; budget
                </Link>
                , then retry.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
      {(video.status === "failed_permanent" ||
        video.status === "policy_blocked") && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>{STATUS_LABELS[video.status]}</AlertTitle>
          <AlertDescription>
            {video.lastError ??
              video.statusDetail ??
              "This video cannot be processed."}{" "}
            This state is final — the video&apos;s metadata stays in your
            library.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          {props.mediaUrl ? (
            <video
              ref={videoRef}
              src={props.mediaUrl}
              poster={props.posterUrl ?? undefined}
              controls
              className="aspect-video w-full rounded-lg bg-black"
            />
          ) : video.embedUrl ? (
            <iframe
              key={embedStart}
              src={`${video.embedUrl}${video.embedUrl.includes("?") ? "&" : "?"}start=${embedStart}`}
              className="aspect-video w-full rounded-lg border-0 bg-black"
              allow="accelerometer; encrypted-media; picture-in-picture"
              allowFullScreen
              title={video.title ?? "Video player"}
            />
          ) : (
            <div className="bg-card border-border text-muted-foreground grid aspect-video w-full place-items-center rounded-lg border text-sm">
              {video.origin === "upload"
                ? "Media not available yet"
                : "No embedded playback for this platform — open the original link"}
            </div>
          )}
          {props.frames.length > 0 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
              {props.frames.map((f) => (
                <button
                  key={f.timeSeconds}
                  type="button"
                  onClick={() => seek(f.timeSeconds)}
                  className="group relative shrink-0 focus-visible:ring-2"
                  title={`Jump to ${tc(f.timeSeconds)}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={`Frame at ${tc(f.timeSeconds)}`}
                    className="h-14 rounded"
                  />
                  <span className="timecode absolute bottom-0.5 left-0.5">
                    {tc(f.timeSeconds)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Latest metrics</CardTitle>
          </CardHeader>
          <CardContent>
            {latest ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {(
                  [
                    ["Views", latest.views],
                    ["Likes", latest.likes],
                    ["Comments", latest.comments],
                    ["Shares", latest.shares],
                    ["Saves", latest.saves],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular-nums">
                      {value != null ? fmt.format(value) : "—"}
                    </dd>
                  </div>
                ))}
                <div className="col-span-2 text-muted-foreground mt-1 text-xs">
                  Captured {new Date(latest.captured_at).toLocaleString()} ·{" "}
                  {props.snapshots.length} snapshot
                  {props.snapshots.length === 1 ? "" : "s"}
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">
                No platform metrics
                {video.platform === "upload"
                  ? " — uploaded files have none"
                  : " yet"}
                .
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {!analysis && !active && video.status === "metadata_ready" && (
        <div className="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">Not analyzed yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Deep analysis produces a timestamped breakdown, hook mechanics, and
            original idea candidates. It runs only when you start it.
          </p>
        </div>
      )}

      {analysis && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">Analysis</h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline" title={`Model: ${analysis.model}`}>
                {analysis.provider === "mock"
                  ? "Mock AI output"
                  : analysis.provider === "cache"
                    ? "Cached result"
                    : "AI output"}
              </Badge>
              {props.analyses.length > 1 && (
                <Select
                  value={String(selectedVersion)}
                  onValueChange={(v) => setSelectedVersion(Number(v))}
                >
                  <SelectTrigger
                    className="h-8 w-40"
                    aria-label="Analysis version"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {props.analyses.map((a) => (
                      <SelectItem key={a.version} value={String(a.version)}>
                        v{a.version} ·{" "}
                        {new Date(a.createdAt).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Tabs defaultValue="overview" className="mt-3">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="structure">Structure</TabsTrigger>
              <TabsTrigger value="ideas">
                Ideas ({analysis.content.ideaCandidates.length})
              </TabsTrigger>
              <TabsTrigger value="notes">My notes</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card>
                <CardContent className="space-y-3 pt-5 text-sm">
                  <p>{analysis.content.summary}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide">
                        Target audience
                      </p>
                      <p>{analysis.content.targetAudience}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide">
                        Topic
                      </p>
                      <p>{analysis.content.topic}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-muted-foreground text-xs uppercase tracking-wide">
                        Primary message
                      </p>
                      <p>{analysis.content.primaryMessage}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Performance context</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p>{analysis.content.performanceContext.interpretation}</p>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Based on:{" "}
                    {analysis.content.performanceContext.referencedMetrics.join(
                      ", ",
                    ) || "no metrics available"}{" "}
                    · Confidence:{" "}
                    {analysis.content.performanceContext.confidence}
                  </p>
                </CardContent>
              </Card>
              {analysis.content.copyingRiskWarnings.length > 0 && (
                <Alert>
                  <AlertTitle>Originality guardrails</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {analysis.content.copyingRiskWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {analysis.content.uncertainties.length > 0 && (
                <div className="text-muted-foreground text-xs">
                  <p className="font-medium">
                    Uncertainties (overall confidence:{" "}
                    {analysis.content.overallConfidence})
                  </p>
                  <ul className="mt-1 list-disc pl-4">
                    {analysis.content.uncertainties.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="transcript" className="mt-4">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-muted-foreground mb-3 text-xs">
                    Source:{" "}
                    {analysis.content.transcriptSource.replace(/_/g, " ")}.{" "}
                    {canSeek ? "Click a timestamp to jump the player." : ""}
                  </p>
                  <ol className="space-y-1.5">
                    {analysis.content.transcript.map((seg) => (
                      <li key={seg.start} className="flex gap-3 text-sm">
                        <button
                          type="button"
                          className="timecode shrink-0"
                          onClick={() => seek(seg.start)}
                          disabled={!canSeek}
                        >
                          {tc(seg.start)}
                        </button>
                        <span>{seg.text}</span>
                      </li>
                    ))}
                  </ol>
                  {analysis.content.onScreenText.length > 0 && (
                    <>
                      <p className="text-muted-foreground mt-5 mb-2 text-xs font-medium uppercase tracking-wide">
                        On-screen text
                      </p>
                      <ul className="space-y-1.5">
                        {analysis.content.onScreenText.map((t) => (
                          <li
                            key={`${t.start}-${t.text}`}
                            className="flex items-center gap-3 text-sm"
                          >
                            <button
                              type="button"
                              className="timecode shrink-0"
                              onClick={() => seek(t.start)}
                              disabled={!canSeek}
                            >
                              {tc(t.start)}
                            </button>
                            <span>&ldquo;{t.text}&rdquo;</span>
                            <Badge variant="outline" className="text-[10px]">
                              {t.role}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="structure" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      Hook · {analysis.content.hook.category.replace(/_/g, " ")}
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () =>
                            saveHookFromAnalysis({
                              mechanism: analysis.content.hook.mechanism,
                              category: analysis.content.hook.category,
                              analysisId: analysis.id,
                            }),
                          "Hook mechanism saved to your library",
                        )
                      }
                    >
                      Save mechanism to hook library
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{analysis.content.hook.mechanism}</p>
                  <p className="text-muted-foreground">
                    {analysis.content.hook.whyItWorks}
                  </p>
                  {analysis.content.hook.sourceQuote && (
                    <p className="text-muted-foreground border-border border-l-2 pl-3 text-xs italic">
                      Source evidence (do not reuse): &ldquo;
                      {analysis.content.hook.sourceQuote}&rdquo;
                      {analysis.content.hook.windowSeconds != null &&
                        ` — first ${analysis.content.hook.windowSeconds}s`}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Storytelling beats</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-2">
                    {analysis.content.beats.map((b) => (
                      <li key={b.start} className="flex gap-3 text-sm">
                        <button
                          type="button"
                          className="timecode h-fit shrink-0"
                          onClick={() => seek(b.start)}
                          disabled={!canSeek}
                        >
                          {tc(b.start)}
                        </button>
                        <div>
                          <p className="font-medium">{b.beat}</p>
                          <p className="text-muted-foreground">
                            {b.description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Visual &amp; editing patterns
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {analysis.content.visualPatterns.map((p) => (
                    <div key={p.pattern}>
                      <p>{p.pattern}</p>
                      <p className="text-muted-foreground text-xs">
                        {p.timestamps.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className="timecode mr-1"
                            onClick={() => seek(t)}
                            disabled={!canSeek}
                          >
                            {tc(t)}
                          </button>
                        ))}
                        {p.notes}
                      </p>
                    </div>
                  ))}
                  {analysis.content.editingNotes && (
                    <p className="text-muted-foreground">
                      {analysis.content.editingNotes}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ideas" className="mt-4 space-y-3">
              {analysis.content.ideaCandidates.map((idea) => (
                <Card key={idea.title}>
                  <CardContent className="pt-5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{idea.title}</p>
                      <Badge
                        variant={
                          idea.copyingRisk === "high"
                            ? "destructive"
                            : idea.copyingRisk === "medium"
                              ? "default"
                              : "outline"
                        }
                      >
                        {idea.copyingRisk} copying risk
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1">{idea.angle}</p>
                    <p className="mt-2 text-xs">
                      <span className="text-muted-foreground">
                        Why it&apos;s original:
                      </span>{" "}
                      {idea.originalityRationale}
                    </p>
                    {idea.copyingRiskNote && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {idea.copyingRiskNote}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {idea.evidence.map((e) => (
                        <span key={e} className="timecode">
                          {e}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              <p className="text-muted-foreground text-xs">
                These candidates were also delivered to your{" "}
                <Link href="/ideas" className="underline">
                  Ideas inbox
                </Link>{" "}
                ({props.ideas.length} from this video) for triage.
              </p>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-muted-foreground mb-2 text-xs">
                    Your notes are stored separately from AI output —
                    regeneration never touches them.
                  </p>
                  <Textarea
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setNotesDirty(true);
                    }}
                    rows={8}
                    placeholder="What did you take from this video? Angles to steal (structurally), things to avoid…"
                    aria-label="Personal notes"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      disabled={!notesDirty || pending}
                      onClick={() =>
                        act(async () => {
                          const r = await saveAnalysisNotes(video.id, notes);
                          if (r.ok) setNotesDirty(false);
                          return r;
                        }, "Notes saved")
                      }
                    >
                      Save notes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardContent className="pt-5">
                  <ol className="space-y-2 text-sm">
                    {props.events.map((e, i) => (
                      <li key={i} className="flex items-baseline gap-3">
                        <span className="timecode shrink-0">
                          {new Date(e.created_at).toLocaleTimeString()}
                        </span>
                        <span>
                          {e.from_status
                            ? `${STATUS_LABELS[e.from_status as PipelineStatus] ?? e.from_status} → `
                            : ""}
                          <span className="font-medium">
                            {STATUS_LABELS[e.to_status as PipelineStatus] ??
                              e.to_status}
                          </span>
                          {e.detail && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {e.detail}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {!analysis && props.events.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {props.events.map((e, i) => (
                <li key={i} className="flex items-baseline gap-3">
                  <span className="timecode shrink-0">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                  <span>
                    <span className="font-medium">
                      {STATUS_LABELS[e.to_status as PipelineStatus] ??
                        e.to_status}
                    </span>
                    {e.detail && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {e.detail}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this analysis?</DialogTitle>
            <DialogDescription>
              A new analysis version will be created — the current version and
              your notes are kept. This re-runs the full pipeline and counts
              against your budget.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRegen(false)}>
              Keep current version
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setConfirmRegen(false);
                act(() => regenerateAnalysis(video.id), "Regeneration started");
              }}
            >
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
