"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  convertToScript,
  saveNotes,
  setIdeaStatus,
  type IdeaStatus,
} from "./actions";

export interface IdeaRow {
  id: string;
  video_id: string | null;
  analysis_id: string | null;
  title: string;
  angle: string | null;
  status: IdeaStatus;
  storytelling_format: string | null;
  persona_relevance: string | null;
  originality_rationale: string | null;
  evidence: string[] | null;
  copying_risk: "low" | "medium" | "high" | null;
  copying_risk_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceVideo {
  title: string | null;
  platform: string;
}

const TAB_ORDER = ["inbox", "shortlisted", "archived", "discarded"] as const;

const TAB_LABELS: Record<IdeaStatus, string> = {
  inbox: "Inbox",
  shortlisted: "Shortlist",
  archived: "Archived",
  discarded: "Discarded",
};

const STATUS_TOASTS: Record<IdeaStatus, string> = {
  inbox: "Idea restored to the inbox",
  shortlisted: "Idea shortlisted",
  archived: "Idea archived",
  discarded: "Idea discarded",
};

function EmptyState({ tab }: { tab: IdeaStatus }) {
  return (
    <div className="border-border mt-4 rounded-lg border border-dashed p-10 text-center">
      {tab === "inbox" ? (
        <>
          <p className="text-sm font-medium">
            Analyses drop their idea candidates here
          </p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Run a deep analysis on a video and its most promising angles land in
            this inbox, ready to triage.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/videos">Analyze a video</Link>
          </Button>
        </>
      ) : tab === "shortlisted" ? (
        <>
          <p className="text-sm font-medium">Nothing shortlisted yet</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Shortlist the ideas worth making from your inbox — this becomes your
            shooting list, one click away from a script.
          </p>
        </>
      ) : tab === "archived" ? (
        <>
          <p className="text-sm font-medium">No archived ideas</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Archive ideas that aren&apos;t right for now but too good to throw
            away. Restore them whenever the timing works.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Nothing discarded</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Discarded ideas stay here for reference, so you remember what
            you&apos;ve already passed on.
          </p>
        </>
      )}
    </div>
  );
}

function riskBadge(idea: IdeaRow) {
  if (!idea.copying_risk) return null;
  const badge =
    idea.copying_risk === "high" ? (
      <Badge variant="destructive">High copying risk</Badge>
    ) : idea.copying_risk === "medium" ? (
      <Badge variant="outline" className="border-primary/60 text-primary">
        Medium copying risk
      </Badge>
    ) : (
      <Badge variant="outline">Low copying risk</Badge>
    );
  if (!idea.copying_risk_note) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent>{idea.copying_risk_note}</TooltipContent>
    </Tooltip>
  );
}

function IdeaCard({
  idea,
  video,
}: {
  idea: IdeaRow;
  video: SourceVideo | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [notes, setNotes] = useState(idea.notes ?? "");
  const notesDirty = notes !== (idea.notes ?? "");

  function moveTo(status: IdeaStatus) {
    startTransition(async () => {
      const res = await setIdeaStatus(idea.id, status);
      if (res.ok) toast.success(STATUS_TOASTS[status]);
      else toast.error(res.error ?? "Could not update the idea.");
      router.refresh();
    });
  }

  function persistNotes() {
    startTransition(async () => {
      const res = await saveNotes(idea.id, notes);
      if (res.ok) toast.success("Notes saved");
      else toast.error(res.error ?? "Could not save notes.");
      router.refresh();
    });
  }

  function develop() {
    startTransition(async () => {
      const res = await convertToScript(idea.id);
      if (res.ok && res.scriptId) {
        toast.success(
          res.existing
            ? "Opening the existing script for this idea"
            : "Script created — opening the wizard",
        );
        router.push(`/scripts/${res.scriptId}/wizard`);
      } else {
        toast.error(res.error ?? "Could not create the script.");
      }
    });
  }

  const evidence = Array.isArray(idea.evidence) ? idea.evidence : [];
  const canDevelop = idea.status === "inbox" || idea.status === "shortlisted";

  return (
    <li className="bg-card border-border flex flex-col rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {idea.storytelling_format && (
          <Badge variant="secondary">{idea.storytelling_format}</Badge>
        )}
        {riskBadge(idea)}
      </div>

      <p className="mt-2 text-sm font-medium leading-snug">{idea.title}</p>
      {idea.angle && (
        <p className="text-foreground/80 mt-1 text-sm">{idea.angle}</p>
      )}
      {idea.persona_relevance && (
        <p className="text-muted-foreground mt-2 text-xs">
          {idea.persona_relevance}
        </p>
      )}

      {evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {evidence.map((e, i) => (
            <span key={i} className="timecode">
              {e}
            </span>
          ))}
        </div>
      )}

      {idea.video_id && (
        <p className="text-muted-foreground mt-2 text-xs">
          From{" "}
          <Link
            href={`/videos/${idea.video_id}`}
            className="text-foreground hover:underline"
          >
            {video?.title ?? "source video"}
          </Link>
          {video?.platform ? (
            <span className="capitalize"> · {video.platform}</span>
          ) : null}
        </p>
      )}

      <div className="mt-3">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Your notes (never touched by AI)…"
          rows={2}
          className="text-sm"
          aria-label={`Notes for ${idea.title}`}
        />
        {notesDirty && (
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNotes(idea.notes ?? "")}
              disabled={pending}
            >
              Reset
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={persistNotes}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save notes"}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {canDevelop && (
          <Button size="sm" onClick={develop} disabled={pending}>
            {pending ? "Working…" : "Develop into script"}
          </Button>
        )}
        {idea.status === "inbox" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => moveTo("shortlisted")}
              disabled={pending}
            >
              Shortlist
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => moveTo("archived")}
              disabled={pending}
            >
              Archive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscard(true)}
              disabled={pending}
            >
              Discard
            </Button>
          </>
        )}
        {idea.status === "shortlisted" && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => moveTo("inbox")}
              disabled={pending}
            >
              Back to inbox
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => moveTo("archived")}
              disabled={pending}
            >
              Archive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscard(true)}
              disabled={pending}
            >
              Discard
            </Button>
          </>
        )}
        {(idea.status === "discarded" || idea.status === "archived") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => moveTo("inbox")}
            disabled={pending}
          >
            Restore to inbox
          </Button>
        )}
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this idea?</DialogTitle>
            <DialogDescription>
              &ldquo;{idea.title}&rdquo; moves to the Discarded tab. It stays
              there for reference and you can restore it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setConfirmDiscard(false);
                moveTo("discarded");
              }}
            >
              Discard idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function IdeasInbox({
  ideas,
  videos,
}: {
  ideas: IdeaRow[];
  videos: Record<string, SourceVideo>;
}) {
  const byStatus = (status: IdeaStatus) =>
    ideas.filter((i) => i.status === status);

  return (
    <TooltipProvider>
      <Tabs defaultValue="inbox" className="mt-6">
        <TabsList>
          {TAB_ORDER.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {TAB_LABELS[tab]} ({byStatus(tab).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {TAB_ORDER.map((tab) => {
          const list = byStatus(tab);
          return (
            <TabsContent key={tab} value={tab}>
              {list.length === 0 ? (
                <EmptyState tab={tab} />
              ) : (
                <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      video={idea.video_id ? videos[idea.video_id] : undefined}
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </TooltipProvider>
  );
}
