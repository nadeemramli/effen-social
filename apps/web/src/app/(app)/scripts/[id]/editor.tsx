"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  estimateSpokenSeconds,
  scriptFullText,
  scriptMarkdown,
  scriptPlainText,
  SCRIPT_STATUSES,
  type ScriptStatus,
  type ScriptV1,
} from "@effen/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  regenerateSection,
  restoreVersion,
  reviseScript,
  saveDraft,
  setScriptStatus,
} from "../actions";

interface VersionRecord {
  version: number;
  content: ScriptV1;
  createdBy: "ai" | "user";
  label: string | null;
  createdAt: string;
}

const STATUS_HELP: Record<ScriptStatus, string> = {
  draft: "Still being shaped.",
  revising: "Actively being revised.",
  ready: "You marked this ready to record — this never happens automatically.",
  recorded: "Filmed. Kept for reference.",
  archived: "Out of rotation.",
};

export function Editor(props: {
  scriptId: string;
  status: ScriptStatus;
  currentVersion: number;
  versions: VersionRecord[];
}) {
  const router = useRouter();
  const latest = props.versions[0]!;
  const [content, setContent] = useState<ScriptV1>(latest.content);
  const [viewVersion, setViewVersion] = useState(latest.version);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">(
    "saved",
  );
  const [instruction, setInstruction] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewing =
    props.versions.find((v) => v.version === viewVersion) ?? latest;
  const isLatest = viewVersion === latest.version;

  // Autosave: debounce 1.2s after the last edit; only the latest version is editable.
  const scheduleSave = useCallback(
    (next: ScriptV1) => {
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setSaveState("saving");
        void saveDraft(props.scriptId, next).then((res) => {
          setSaveState(res.ok ? "saved" : "dirty");
          if (!res.ok)
            toast.error(
              res.error ??
                "Autosave failed — your edits are still in this tab.",
            );
        });
      }, 1200);
    },
    [props.scriptId],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  function editSection(id: string, text: string) {
    const next = {
      ...content,
      sections: content.sections.map((s) =>
        s.id === id ? { ...s, content: text } : s,
      ),
    };
    setContent(next);
    scheduleSave(next);
  }

  function editTitle(title: string) {
    const next = { ...content, title };
    setContent(next);
    scheduleSave(next);
  }

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; blocked?: string }>,
    okMsg: string,
  ) {
    setBlocked(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(okMsg);
      else if (res.blocked) setBlocked(res.blocked);
      else toast.error(res.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  const spokenSeconds = useMemo(
    () => estimateSpokenSeconds(scriptFullText(content)),
    [content],
  );

  function download(kind: "txt" | "md") {
    const text =
      kind === "txt" ? scriptPlainText(content) : scriptMarkdown(content);
    const blob = new Blob([text], {
      type: kind === "txt" ? "text/plain" : "text/markdown",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${content.title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "script"}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={content.title}
          onChange={(e) => editTitle(e.target.value)}
          disabled={!isLatest}
          aria-label="Script title"
          className="h-10 max-w-md border-transparent bg-transparent px-1 text-lg font-semibold focus-visible:border-input"
        />
        <div className="flex items-center gap-2">
          <span
            className="timecode"
            title="Estimated spoken duration at ~150 wpm"
          >
            ⏱ {Math.floor(spokenSeconds / 60)}:
            {String(spokenSeconds % 60).padStart(2, "0")} spoken
          </span>
          <span
            className="text-muted-foreground text-xs"
            role="status"
            aria-live="polite"
          >
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
                ? "Saving…"
                : "Unsaved edits"}
          </span>
          <Select
            value={props.status}
            onValueChange={(v) =>
              run(
                () => setScriptStatus(props.scriptId, v as ScriptStatus),
                `Status set to ${v}`,
              )
            }
          >
            <SelectTrigger
              className="h-8 w-32 capitalize"
              aria-label="Script status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCRIPT_STATUSES.map((s) => (
                <SelectItem
                  key={s}
                  value={s}
                  className="capitalize"
                  title={STATUS_HELP[s]}
                >
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => download("txt")}>
                Plain text (.txt)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => download("md")}>
                Markdown (.md)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {blocked && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>Blocked by budget</AlertTitle>
          <AlertDescription>{blocked}</AlertDescription>
        </Alert>
      )}

      {!isLatest && (
        <Alert className="mt-3">
          <AlertTitle>Viewing v{viewVersion} (read-only)</AlertTitle>
          <AlertDescription>
            <div className="mt-1 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmRestore(viewVersion)}
              >
                Restore this version
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setViewVersion(latest.version);
                  setContent(latest.content);
                }}
              >
                Back to latest
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4">
          {(isLatest ? content : viewing.content).sections.map((section) => (
            <Card key={section.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm">{section.heading}</CardTitle>
                {isLatest && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => regenerateSection(props.scriptId, section.id),
                        `${section.heading} regenerated (other sections untouched)`,
                      )
                    }
                  >
                    Regenerate section
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {isLatest ? (
                  <Textarea
                    value={section.content}
                    onChange={(e) => editSection(section.id, e.target.value)}
                    rows={Math.max(
                      3,
                      Math.min(14, section.content.split("\n").length + 2),
                    )}
                    aria-label={`${section.heading} content`}
                    className="border-transparent bg-transparent px-1 focus-visible:border-input"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm">
                    {
                      viewing.content.sections.find((s) => s.id === section.id)
                        ?.content
                    }
                  </p>
                )}
              </CardContent>
            </Card>
          ))}

          {isLatest && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Revise with an instruction
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder='e.g. "make it tighter" or "punchier hook"'
                    aria-label="Revision instruction"
                  />
                  <Button
                    disabled={pending || instruction.trim().length < 5}
                    onClick={() =>
                      run(async () => {
                        const r = await reviseScript(
                          props.scriptId,
                          instruction,
                        );
                        if (r.ok) setInstruction("");
                        return r;
                      }, "Revision created as a new version")
                    }
                  >
                    {pending ? "Revising…" : "Revise"}
                  </Button>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  Revisions create a new version — the current one stays in
                  history.
                </p>
              </CardContent>
            </Card>
          )}

          {content.claimsToVerify.length > 0 && (
            <Alert>
              <AlertTitle>Claims to verify before recording</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {content.claimsToVerify.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {content.deliveryNotes && (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">Delivery notes:</span>{" "}
              {content.deliveryNotes}
            </p>
          )}
        </div>

        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Version history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1.5">
                {props.versions.map((v) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() => {
                        setViewVersion(v.version);
                        if (v.version === latest.version)
                          setContent(latest.content);
                      }}
                      aria-current={
                        v.version === viewVersion ? "true" : undefined
                      }
                      className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        v.version === viewVersion
                          ? "bg-accent"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <span className="flex items-center justify-between">
                        <span className="font-medium">v{v.version}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {v.createdBy === "ai" ? "AI" : "You"}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground block truncate">
                        {v.label ?? "—"} ·{" "}
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={confirmRestore != null}
        onOpenChange={(o) => !o && setConfirmRestore(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore v{confirmRestore}?</DialogTitle>
            <DialogDescription>
              The restored content becomes a new version at the top of the
              history. Nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRestore(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                const v = confirmRestore!;
                setConfirmRestore(null);
                run(
                  () => restoreVersion(props.scriptId, v),
                  `Restored v${v} as the latest version`,
                );
              }}
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
