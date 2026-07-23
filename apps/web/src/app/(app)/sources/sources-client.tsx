"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  addSource,
  deleteSource,
  refreshSource,
  toggleSource,
  updateTags,
  type SourceActionResult,
} from "./actions";

export interface SourceRow {
  id: string;
  platform: "youtube" | "instagram" | "tiktok" | "upload";
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number | null;
  profile_url: string | null;
  tags: string[];
  enabled: boolean;
  last_discovered_at: string | null;
  videoCount: number;
}

const fmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const PLATFORM_LABELS: Record<SourceRow["platform"], string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  upload: "Upload",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface ActionAlert {
  kind: "budget" | "provider";
  message: string;
}

function alertFromResult(res: SourceActionResult): ActionAlert | null {
  if (res.blocked) return { kind: "budget", message: res.blocked };
  if (
    !res.ok &&
    (res.kind === "policy" ||
      res.kind === "provider_down" ||
      res.kind === "quota_exhausted")
  ) {
    return {
      kind: "provider",
      message: res.error ?? "The provider is unavailable.",
    };
  }
  return null;
}

function AlertBanner({
  alert,
  onDismiss,
}: {
  alert: ActionAlert;
  onDismiss: () => void;
}) {
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>
        {alert.kind === "budget" ? "Blocked by budget" : "Provider unavailable"}
      </AlertTitle>
      <AlertDescription>
        {alert.message}{" "}
        {alert.kind === "budget" ? (
          <>
            Adjust limits in{" "}
            <Link href="/settings" className="underline">
              Usage &amp; budget
            </Link>
            . Nothing was pulled and nothing was spent.
          </>
        ) : (
          <>
            Check provider settings in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            , or try again later. Nothing was spent.
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 block h-7 px-2"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function discoveryToast(res: SourceActionResult, verb: string) {
  const added = res.added ?? 0;
  const skipped = res.skippedDuplicates ?? 0;
  toast.success(`${verb} ${added} new video${added === 1 ? "" : "s"}`, {
    description: skipped
      ? `${skipped} already in your library — skipped.`
      : "Metadata only; run analysis from the library when ready.",
  });
}

/* ------------------------------------------------------------ add form */

export function AddSourceForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [alert, setAlert] = useState<ActionAlert | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const value = url.trim();
    if (!value) return;
    startTransition(async () => {
      const res = await addSource(value);
      const banner = alertFromResult(res);
      if (banner) {
        setAlert(banner);
      } else if (res.ok) {
        setAlert(null);
        setUrl("");
        discoveryToast(res, "Source added — pulled");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not add that source.");
      }
    });
  }

  return (
    <div className="mt-6">
      {alert && <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a profile URL — youtube.com/@handle, tiktok.com/@handle, instagram.com/handle"
          className="h-9 w-full max-w-xl"
          aria-label="Creator profile URL"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !url.trim()}>
          {pending ? "Pulling latest…" : "Watch creator"}
        </Button>
      </form>
      <p className="text-muted-foreground mt-1.5 text-xs">
        Adding a source pulls the creator&apos;s recent videos as metadata —
        cheap and instant. Deep analysis is a separate, per-video step.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ list */

export function SourcesList({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  const [alert, setAlert] = useState<ActionAlert | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tagsFor, setTagsFor] = useState<SourceRow | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");
  const [deleteFor, setDeleteFor] = useState<SourceRow | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    sourceId: string,
    fn: () => Promise<SourceActionResult>,
    onOk: (res: SourceActionResult) => void,
  ) {
    setBusyId(sourceId);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      const banner = alertFromResult(res);
      if (banner) setAlert(banner);
      else if (res.ok) {
        setAlert(null);
        onOk(res);
        router.refresh();
      } else toast.error(res.error ?? "That didn't work — try again.");
    });
  }

  function pullLatest(s: SourceRow) {
    run(
      s.id,
      () => refreshSource(s.id),
      (res) => discoveryToast(res, "Pulled"),
    );
  }

  function toggle(s: SourceRow, enabled: boolean) {
    run(
      s.id,
      () => toggleSource(s.id, enabled),
      () =>
        toast.success(
          enabled ? `Watching ${label(s)} again` : `Paused ${label(s)}`,
        ),
    );
  }

  function saveTags() {
    const s = tagsFor;
    if (!s) return;
    const tags = tagsDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setTagsFor(null);
    run(
      s.id,
      () => updateTags(s.id, tags),
      () => toast.success(`Tags updated for ${label(s)}`),
    );
  }

  function confirmDelete() {
    const s = deleteFor;
    if (!s) return;
    setDeleteFor(null);
    run(
      s.id,
      () => deleteSource(s.id),
      () =>
        toast.success(`Removed ${label(s)}`, {
          description: "Its videos stay in your library.",
        }),
    );
  }

  const label = (s: SourceRow) =>
    s.display_name ??
    (s.handle ? `@${s.handle.replace(/^@/, "")}` : "this source");

  return (
    <div className="mt-6">
      {alert && <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />}

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th className="p-2 font-medium">Creator</th>
              <th className="p-2 font-medium">Platform</th>
              <th className="p-2 text-right font-medium">Followers</th>
              <th className="p-2 text-right font-medium">Videos</th>
              <th className="p-2 font-medium">Tags</th>
              <th className="p-2 font-medium">Last pulled</th>
              <th className="p-2 font-medium">Watching</th>
              <th className="p-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const busy = busyId === s.id && pending;
              const handle = s.handle ? s.handle.replace(/^@/, "") : null;
              return (
                <tr
                  key={s.id}
                  className="border-border hover:bg-accent/40 border-b last:border-0"
                >
                  <td className="p-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        {s.avatar_url && (
                          <AvatarImage src={s.avatar_url} alt="" />
                        )}
                        <AvatarFallback>
                          {(handle ?? "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="line-clamp-1 font-medium">
                          {s.display_name ??
                            (handle ? `@${handle}` : "Unknown creator")}
                        </p>
                        {handle &&
                          (s.profile_url ? (
                            <a
                              href={s.profile_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground text-xs hover:underline"
                            >
                              @{handle}
                            </a>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              @{handle}
                            </p>
                          ))}
                      </div>
                    </div>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline">
                      {PLATFORM_LABELS[s.platform]}
                    </Badge>
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {s.follower_count != null
                      ? fmt.format(s.follower_count)
                      : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {handle ? (
                      <Link
                        href={`/videos?source=${encodeURIComponent(handle)}`}
                        className="hover:underline"
                        title="View this creator's videos in the library"
                      >
                        {s.videoCount}
                      </Link>
                    ) : (
                      s.videoCount
                    )}
                  </td>
                  <td className="max-w-40 p-2">
                    {s.tags.length ? (
                      <div className="flex flex-wrap gap-1">
                        {s.tags.map((t) => (
                          <Badge
                            key={t}
                            variant="secondary"
                            className="text-[11px]"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground p-2 text-xs">
                    {timeAgo(s.last_discovered_at)}
                  </td>
                  <td className="p-2">
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(checked) => toggle(s, checked)}
                      disabled={busy}
                      aria-label={`Toggle watching ${label(s)}`}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pullLatest(s)}
                        disabled={busy}
                      >
                        {busy ? "Pulling…" : "Pull latest"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTagsFor(s);
                          setTagsDraft(s.tags.join(", "));
                        }}
                        disabled={busy}
                      >
                        Tags
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteFor(s)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!tagsFor} onOpenChange={(o) => !o && setTagsFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit tags{tagsFor ? ` — ${label(tagsFor)}` : ""}
            </DialogTitle>
            <DialogDescription>
              Comma-separated labels for organizing sources, e.g.{" "}
              <span className="text-foreground">
                hooks, education, competitor
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveTags();
            }}
          >
            <Input
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              placeholder="hooks, education, competitor"
              aria-label="Tags, comma separated"
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTagsFor(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save tags"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove {deleteFor ? label(deleteFor) : "source"}?
            </DialogTitle>
            <DialogDescription>
              This stops watching the creator. Videos already pulled stay in
              your library — only the source entry is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? "Removing…" : "Remove source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
