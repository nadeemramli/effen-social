"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { restorePersonaVersion } from "./actions";
import type { PersonaContent } from "./schema";

export interface VersionRow {
  id: string;
  version: number;
  createdAt: string;
  content: PersonaContent;
}

interface VersionHistoryProps {
  personaId: string;
  currentVersion: number;
  versions: VersionRow[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function ContentView({ content }: { content: PersonaContent }) {
  return (
    <div className="space-y-4">
      <Field label="Audience">
        <p className="whitespace-pre-wrap">{content.audience || "—"}</p>
      </Field>
      <Field label="Voice & tone">
        <p className="whitespace-pre-wrap">{content.voice || "—"}</p>
      </Field>
      <Field label="Content pillars">
        {content.pillars.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {content.pillars.map((p) => (
              <Badge key={p} variant="secondary">
                {p}
              </Badge>
            ))}
          </div>
        ) : (
          "—"
        )}
      </Field>
      <Field label="Goals">
        <p className="whitespace-pre-wrap">{content.goals || "—"}</p>
      </Field>
      <Field label="Boundaries">
        <p className="whitespace-pre-wrap">{content.boundaries || "—"}</p>
      </Field>
      <Field label="Sample topics">
        {content.sampleTopics.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {content.sampleTopics.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        ) : (
          "—"
        )}
      </Field>
    </div>
  );
}

export function VersionHistory({
  personaId,
  currentVersion,
  versions,
}: VersionHistoryProps) {
  const router = useRouter();
  const [viewing, setViewing] = useState<VersionRow | null>(null);
  const [restoring, setRestoring] = useState<VersionRow | null>(null);
  const [pending, setPending] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function confirmRestore() {
    if (!restoring) return;
    setPending(true);
    setRestoreError(null);
    try {
      const res = await restorePersonaVersion(personaId, restoring.version);
      if (!res.ok) {
        setRestoreError(
          res.error ?? "Could not restore this version. Try again.",
        );
        return;
      }
      toast.success(`Restored v${restoring.version} as v${res.version}`, {
        description:
          "The old version was copied forward — history stays intact.",
      });
      setRestoring(null);
      router.refresh();
    } catch {
      setRestoreError(
        "Something went wrong restoring this version. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <ul
        className="divide-border divide-y"
        aria-label="Persona version history"
      >
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              <Badge
                variant={v.version === currentVersion ? "default" : "outline"}
              >
                v{v.version}
              </Badge>
              {v.version === currentVersion && (
                <span className="text-muted-foreground text-xs">current</span>
              )}
            </div>
            <span className="text-muted-foreground text-xs">
              {formatDate(v.createdAt)}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewing(v)}
                aria-label={`View version ${v.version}`}
              >
                View
              </Button>
              {v.version !== currentVersion && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRestoreError(null);
                    setRestoring(v);
                  }}
                  aria-label={`Restore version ${v.version}`}
                >
                  Restore
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Version {viewing?.version}
              {viewing?.version === currentVersion ? " (current)" : ""}
            </DialogTitle>
            <DialogDescription>
              Saved {viewing ? formatDate(viewing.createdAt) : ""}. Versions are
              read-only.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            {viewing && <ContentView content={viewing.content} />}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRestoring(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore v{restoring?.version}?</DialogTitle>
            <DialogDescription>
              This copies v{restoring?.version} into a new v{currentVersion + 1}{" "}
              and makes it current. No existing version is changed or deleted.
            </DialogDescription>
          </DialogHeader>
          {restoreError && (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t restore</AlertTitle>
              <AlertDescription>{restoreError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRestoring(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRestore}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Restoring…" : "Restore version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
