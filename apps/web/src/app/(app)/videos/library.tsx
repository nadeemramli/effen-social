"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  outlierBucket,
  STATUS_LABELS,
  ACTIVE_STATUSES,
  RETRYABLE_STATUSES,
} from "@effen/core";
import type { VideoWithDerived } from "@/lib/videos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  analyzeVideos,
  estimateAnalysis,
  type AnalyzeEstimate,
} from "./actions";

const fmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--:--";
  const s = Math.round(Number(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function statusBadge(v: VideoWithDerived) {
  const s = v.status;
  if (s === "complete")
    return (
      <Badge className="bg-[var(--effen-teal)] text-[oklch(0.2_0.02_175)]">
        Analyzed
      </Badge>
    );
  if ((ACTIVE_STATUSES as readonly string[]).includes(s))
    return (
      <Badge variant="outline" className="border-primary/60 text-primary">
        <span className="tally-dot tally-dot--live mr-1 !size-1.5" />{" "}
        {STATUS_LABELS[s]}
      </Badge>
    );
  if ((RETRYABLE_STATUSES as readonly string[]).includes(s))
    return <Badge variant="destructive">{STATUS_LABELS[s]}</Badge>;
  if (s === "failed_permanent" || s === "policy_blocked")
    return <Badge variant="destructive">{STATUS_LABELS[s]}</Badge>;
  if (s === "metadata_ready") return <Badge variant="secondary">Ready</Badge>;
  return <Badge variant="outline">{STATUS_LABELS[s]}</Badge>;
}

function outlierChip(v: VideoWithDerived) {
  if (!v.outlier || v.outlier.kind === "insufficient_history") {
    return (
      <span
        className="text-muted-foreground text-xs"
        title="Needs at least 5 videos with view counts from the same source"
      >
        Insufficient history
      </span>
    );
  }
  const b = outlierBucket(v.outlier.score);
  const cls =
    b === "breakout"
      ? "text-primary font-medium"
      : b === "over"
        ? "text-[var(--effen-teal)]"
        : b === "under"
          ? "text-muted-foreground"
          : "text-foreground/80";
  return (
    <span
      className={`text-xs ${cls}`}
      title={`${v.outlier.score.toFixed(1)}× the source's median of ${fmt.format(v.outlier.medianViews)} views (${v.outlier.sampleSize} videos)`}
    >
      {v.outlier.score.toFixed(1)}× median
    </span>
  );
}

export function Library({ videos }: { videos: VideoWithDerived[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<AnalyzeEstimate | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Filters live in the URL so returning from a detail page restores them.
  const q = params.get("q") ?? "";
  const platform = params.get("platform") ?? "all";
  const source = params.get("source") ?? "all";
  const state = params.get("state") ?? "all";
  const sort = params.get("sort") ?? "newest";
  const view = params.get("view") ?? "cards";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all" || (key === "q" && value === ""))
      next.delete(key);
    else next.set(key, value);
    router.replace(`/videos?${next.toString()}`, { scroll: false });
  }

  const sources = useMemo(
    () =>
      [
        ...new Set(
          videos.map((v) => v.sourceHandle).filter((s): s is string => !!s),
        ),
      ].sort(),
    [videos],
  );

  const filtered = useMemo(() => {
    let list = videos;
    if (platform !== "all") list = list.filter((v) => v.platform === platform);
    if (source !== "all") list = list.filter((v) => v.sourceHandle === source);
    if (state === "analyzed") list = list.filter((v) => v.hasAnalysis);
    else if (state === "unanalyzed") list = list.filter((v) => !v.hasAnalysis);
    else if (state === "processing")
      list = list.filter(
        (v) =>
          (ACTIVE_STATUSES as readonly string[]).includes(v.status) ||
          v.status === "selected_for_analysis",
      );
    else if (state === "failed")
      list = list.filter((v) =>
        [
          "failed_retryable",
          "failed_permanent",
          "media_unavailable",
          "budget_blocked",
          "policy_blocked",
        ].includes(v.status),
      );
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (v) =>
          (v.title ?? "").toLowerCase().includes(needle) ||
          (v.caption ?? "").toLowerCase().includes(needle) ||
          (v.sourceHandle ?? "").toLowerCase().includes(needle) ||
          v.hashtags.some((h) => h.toLowerCase().includes(needle)),
      );
    }
    const by: Record<
      string,
      (a: VideoWithDerived, b: VideoWithDerived) => number
    > = {
      newest: (a, b) =>
        (b.published_at ?? b.created_at).localeCompare(
          a.published_at ?? a.created_at,
        ),
      oldest: (a, b) =>
        (a.published_at ?? a.created_at).localeCompare(
          b.published_at ?? b.created_at,
        ),
      views: (a, b) => (b.metrics?.views ?? -1) - (a.metrics?.views ?? -1),
      engagement: (a, b) => (b.engagement ?? -1) - (a.engagement ?? -1),
      outlier: (a, b) =>
        (b.outlier?.kind === "score" ? b.outlier.score : -1) -
        (a.outlier?.kind === "score" ? a.outlier.score : -1),
    };
    return [...list].sort(by[sort] ?? by.newest!);
  }, [videos, q, platform, source, state, sort]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openConfirm() {
    const est = await estimateAnalysis([...selected]);
    setConfirm(est);
  }

  function runAnalysis() {
    startTransition(async () => {
      const ids = confirm?.perVideo.map((p) => p.videoId) ?? [];
      setConfirm(null);
      const res = await analyzeVideos(ids);
      if (res.blocked) {
        setBlocked(res.blocked.detail);
      } else if (res.ok) {
        toast.success(
          `Analysis started for ${res.started} video${res.started === 1 ? "" : "s"}`,
          {
            description: res.skipped.length
              ? `${res.skipped.length} skipped (not in an analyzable state).`
              : "Watch progress in the library.",
          },
        );
        setSelected(new Set());
      } else {
        toast.error(res.error ?? "Could not start analysis.");
      }
      router.refresh();
    });
  }

  const detailHref = (id: string) =>
    `/videos/${id}?back=${encodeURIComponent(`/videos?${params.toString()}`)}`;

  return (
    <div className="mt-6">
      {blocked && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Analysis blocked by budget</AlertTitle>
          <AlertDescription>
            {blocked} Adjust limits in{" "}
            <Link href="/settings" className="underline">
              Usage &amp; budget
            </Link>
            , then retry from each video. Nothing was queued and nothing was
            spent.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2" role="search">
        <Input
          placeholder="Search title, caption, creator, #tag"
          defaultValue={q}
          onChange={(e) => setParam("q", e.target.value)}
          className="h-9 w-56"
          aria-label="Search videos"
        />
        <Select value={platform} onValueChange={(v) => setParam("platform", v)}>
          <SelectTrigger className="h-9 w-32" aria-label="Filter by platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="upload">Uploads</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => setParam("source", v)}>
          <SelectTrigger className="h-9 w-40" aria-label="Filter by creator">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All creators</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(v) => setParam("state", v)}>
          <SelectTrigger className="h-9 w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="analyzed">Analyzed</SelectItem>
            <SelectItem value="unanalyzed">Not analyzed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Needs attention</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
          <SelectTrigger className="h-9 w-40" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="views">Most views</SelectItem>
            <SelectItem value="engagement">Highest engagement</SelectItem>
            <SelectItem value="outlier">Outlier score</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={view === "cards" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setParam("view", "cards")}
          >
            Cards
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setParam("view", "list")}
          >
            List
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bg-card border-border sticky top-14 z-10 mt-3 flex items-center gap-3 rounded-md border px-3 py-2">
          <p className="text-sm">
            <span className="font-medium">{selected.size}</span> selected
          </p>
          <Button size="sm" onClick={openConfirm} disabled={pending}>
            Analyze selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No videos match these filters</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => router.replace("/videos")}
          >
            Clear all filters
          </Button>
        </div>
      ) : view === "cards" ? (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((v) => (
            <li
              key={v.id}
              className="bg-card border-border group relative flex flex-col rounded-lg border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <Checkbox
                  checked={selected.has(v.id)}
                  onCheckedChange={() => toggle(v.id)}
                  aria-label={`Select ${v.title ?? "video"}`}
                />
                {statusBadge(v)}
              </div>
              <Link href={detailHref(v.id)} className="mt-2 block">
                <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline">
                  {v.title ?? v.caption?.slice(0, 80) ?? "Untitled video"}
                </p>
              </Link>
              <p className="text-muted-foreground mt-1 text-xs">
                {v.sourceHandle ??
                  (v.platform === "upload" ? "Uploaded file" : v.platform)}
              </p>
              <div className="mt-auto flex items-center justify-between pt-3">
                <span className="timecode">
                  {formatDuration(v.duration_seconds)}
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground" title="Views">
                    {v.metrics?.views != null
                      ? `${fmt.format(v.metrics.views)} views`
                      : "views n/a"}
                  </span>
                  {v.engagement != null && (
                    <span
                      className="text-muted-foreground"
                      title="Engagement rate"
                    >
                      {(v.engagement * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground text-[11px] capitalize">
                  {v.platform}
                </span>
                {outlierChip(v)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-border mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th className="w-10 p-2">
                  <Checkbox
                    checked={
                      filtered.length > 0 &&
                      filtered.every((v) => selected.has(v.id))
                    }
                    onCheckedChange={(c) =>
                      setSelected(
                        c ? new Set(filtered.map((v) => v.id)) : new Set(),
                      )
                    }
                    aria-label="Select all"
                  />
                </th>
                <th className="p-2 font-medium">Video</th>
                <th className="p-2 font-medium">Creator</th>
                <th className="p-2 font-medium">Published</th>
                <th className="p-2 text-right font-medium">Views</th>
                <th className="p-2 text-right font-medium">Engagement</th>
                <th className="p-2 text-right font-medium">Outlier</th>
                <th className="p-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  className="border-border hover:bg-accent/40 border-b last:border-0"
                >
                  <td className="p-2">
                    <Checkbox
                      checked={selected.has(v.id)}
                      onCheckedChange={() => toggle(v.id)}
                      aria-label={`Select ${v.title ?? "video"}`}
                    />
                  </td>
                  <td className="max-w-64 p-2">
                    <Link
                      href={detailHref(v.id)}
                      className="line-clamp-1 font-medium hover:underline"
                    >
                      {v.title ?? v.caption?.slice(0, 60) ?? "Untitled video"}
                    </Link>
                    <span className="timecode mt-0.5">
                      {formatDuration(v.duration_seconds)}
                    </span>
                  </td>
                  <td className="text-muted-foreground p-2">
                    {v.sourceHandle ?? "—"}
                  </td>
                  <td className="text-muted-foreground p-2 text-xs">
                    {v.published_at
                      ? new Date(v.published_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {v.metrics?.views != null
                      ? fmt.format(v.metrics.views)
                      : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {v.engagement != null
                      ? `${(v.engagement * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="p-2 text-right">{outlierChip(v)}</td>
                  <td className="p-2">{statusBadge(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Analyze {confirm?.itemCount} video
              {confirm?.itemCount === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              Deep analysis downloads/normalizes media where needed,
              transcribes, and produces a structured breakdown with idea
              candidates. Estimated cost:{" "}
              <span className="text-foreground font-medium">
                ${confirm?.estimatedUsd.toFixed(2)}
              </span>{" "}
              (live-mode pricing
              {process.env.NODE_ENV !== "production" ? "" : ""}; mock mode
              spends $0).
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {confirm?.perVideo.map((p) => (
              <li key={p.videoId} className="flex justify-between gap-2">
                <span className="line-clamp-1">{p.title ?? "Untitled"}</span>
                <span className="text-muted-foreground tabular-nums">
                  ${p.estimatedUsd.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={runAnalysis} disabled={pending}>
              {pending ? "Starting…" : "Start analysis"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
