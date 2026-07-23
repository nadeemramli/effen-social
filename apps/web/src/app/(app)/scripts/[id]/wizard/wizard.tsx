"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ResearchV1 } from "@effen/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  chooseHook,
  generateScript,
  runHooks,
  runResearch,
  saveTopic,
  setStage,
} from "../../actions";

const STAGES = ["topic", "research", "hook", "script"] as const;
type Stage = (typeof STAGES)[number];

interface HookOption {
  text: string;
  mechanism: string;
  category: string;
  rationale: string;
}

export function Wizard(props: {
  scriptId: string;
  initialStage: Stage;
  topic: {
    topic?: string;
    angle?: string;
    audience?: string;
    notes?: string;
  } | null;
  research: ResearchV1 | null;
  hook: { options?: HookOption[]; selected?: string } | null;
  hasDraft: boolean;
}) {
  const router = useRouter();
  const [stage, setStageLocal] = useState<Stage>(props.initialStage);
  const [topic, setTopic] = useState(props.topic?.topic ?? "");
  const [angle, setAngle] = useState(props.topic?.angle ?? "");
  const [audience, setAudience] = useState(props.topic?.audience ?? "");
  const [notes, setNotes] = useState(props.topic?.notes ?? "");
  const [customHook, setCustomHook] = useState(props.hook?.selected ?? "");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function go(next: Stage) {
    // Moving between stages never discards saved work — the server keeps every field.
    setStageLocal(next);
    startTransition(async () => {
      await setStage(props.scriptId, next);
      router.refresh();
    });
  }

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; blocked?: string }>,
    okMsg: string,
    andThen?: () => void,
  ) {
    setBlocked(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        andThen?.();
      } else if (res.blocked) setBlocked(res.blocked);
      else toast.error(res.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  const stageIndex = STAGES.indexOf(stage);

  return (
    <div className="mt-3">
      <nav aria-label="Wizard stages" className="flex items-center gap-1">
        {STAGES.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => i <= stageIndex && go(s)}
            disabled={i > stageIndex}
            aria-current={s === stage ? "step" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
              s === stage
                ? "bg-primary text-primary-foreground font-medium"
                : i < stageIndex
                  ? "text-foreground hover:bg-accent"
                  : "text-muted-foreground/50"
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </nav>
      <p className="text-muted-foreground mt-1.5 text-xs">
        You can go back to any earlier stage — nothing you&apos;ve saved is
        lost.
      </p>

      {blocked && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Blocked by budget</AlertTitle>
          <AlertDescription>
            {blocked} Adjust limits in Usage &amp; budget, then try again.
          </AlertDescription>
        </Alert>
      )}

      {stage === "topic" && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">
              What is this video about?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="w-topic">Topic</Label>
              <Input
                id="w-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Hook writing under 3 seconds"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-angle">Angle (optional)</Label>
              <Input
                id="w-angle"
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                placeholder="Your take — what makes this yours?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-audience">Audience (optional)</Label>
              <Input
                id="w-audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Who is this for?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-notes">Your notes (optional)</Label>
              <Textarea
                id="w-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything the research and script should respect"
              />
            </div>
            <div className="flex justify-end">
              <Button
                disabled={pending || topic.trim().length < 3}
                onClick={() =>
                  run(
                    () =>
                      saveTopic(props.scriptId, {
                        topic,
                        angle,
                        audience,
                        notes,
                      }),
                    "Topic saved",
                    () => go("research"),
                  )
                }
              >
                Save &amp; continue to research
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "research" && (
        <div className="mt-4 space-y-4">
          {!props.research ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="font-medium">Research the topic</p>
                <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
                  Pulls together an angle summary, findings (with anything
                  unverifiable flagged), audience questions, and contrarian
                  takes for &ldquo;{topic || props.topic?.topic}&rdquo;.
                </p>
                <Button
                  className="mt-4"
                  disabled={pending}
                  onClick={() =>
                    run(() => runResearch(props.scriptId), "Research ready")
                  }
                >
                  {pending ? "Researching…" : "Run research"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Angle summary</CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {props.research.angleSummary}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Findings</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm">
                    {props.research.findings.map((f) => (
                      <li key={f.claim}>
                        <div className="flex items-start justify-between gap-2">
                          <p>{f.claim}</p>
                          {f.needsVerification && (
                            <Badge
                              variant="destructive"
                              className="shrink-0 text-[10px]"
                            >
                              needs verification
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {f.support}
                          {f.source
                            ? ` — ${f.source}`
                            : " — no source available; verify before recording"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      Audience questions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-muted-foreground list-disc pl-4 text-sm">
                      {props.research.audienceQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Contrarian takes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-muted-foreground list-disc pl-4 text-sm">
                      {props.research.contrarianTakes.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => go("topic")}
                >
                  ← Topic
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => runResearch(props.scriptId),
                        "Research refreshed",
                      )
                    }
                  >
                    Re-run research
                  </Button>
                  <Button disabled={pending} onClick={() => go("hook")}>
                    Continue to hooks
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {stage === "hook" && (
        <div className="mt-4 space-y-4">
          {!props.hook?.options?.length ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="font-medium">Generate hook options</p>
                <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
                  Four original hooks with their mechanisms — pick one or write
                  your own.
                </p>
                <Button
                  className="mt-4"
                  disabled={pending}
                  onClick={() =>
                    run(() => runHooks(props.scriptId), "Hooks ready")
                  }
                >
                  {pending ? "Generating…" : "Generate hooks"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div
                className="space-y-2"
                role="radiogroup"
                aria-label="Hook options"
              >
                {props.hook.options.map((h) => {
                  const selected = props.hook?.selected === h.text;
                  return (
                    <button
                      key={h.text}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => chooseHook(props.scriptId, h.text),
                          "Hook selected",
                        )
                      }
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-accent/40"
                      }`}
                    >
                      <p className="text-sm font-medium">{h.text}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        <Badge variant="outline" className="mr-1.5 text-[10px]">
                          {h.category.replace(/_/g, " ")}
                        </Badge>
                        {h.mechanism}
                      </p>
                    </button>
                  );
                })}
              </div>
              <Card>
                <CardContent className="pt-5">
                  <Label htmlFor="custom-hook">Or write your own</Label>
                  <div className="mt-2 flex gap-2">
                    <Input
                      id="custom-hook"
                      value={customHook}
                      onChange={(e) => setCustomHook(e.target.value)}
                      placeholder="Your opening line"
                    />
                    <Button
                      variant="outline"
                      disabled={pending || customHook.trim().length < 5}
                      onClick={() =>
                        run(
                          () => chooseHook(props.scriptId, customHook),
                          "Hook selected",
                        )
                      }
                    >
                      Use this
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => go("research")}
                >
                  ← Research
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => runHooks(props.scriptId),
                        "New options generated",
                      )
                    }
                  >
                    More options
                  </Button>
                  <Button
                    disabled={pending || !props.hook?.selected}
                    onClick={() => go("script")}
                  >
                    Continue to script
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {stage === "script" && (
        <Card className="mt-4">
          <CardContent className="pt-6 text-center">
            {props.hasDraft ? (
              <>
                <p className="font-medium">Draft ready</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Open the editor to refine, version, and export it.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button
                    onClick={() => router.push(`/scripts/${props.scriptId}`)}
                  >
                    Open editor
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => generateScript(props.scriptId),
                        "New draft generated",
                      )
                    }
                  >
                    Generate fresh draft
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="font-medium">Draft the script</p>
                <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
                  Uses your topic, the research, and the selected hook:{" "}
                  <span className="text-foreground italic">
                    &ldquo;{props.hook?.selected}&rdquo;
                  </span>
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => go("hook")}
                  >
                    ← Hooks
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => generateScript(props.scriptId),
                        "Draft generated",
                        () => router.push(`/scripts/${props.scriptId}`),
                      )
                    }
                  >
                    {pending ? "Writing…" : "Generate script"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
