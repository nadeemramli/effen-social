"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { savePersona } from "./actions";
import type { PersonaContent } from "./schema";

interface PersonaFormProps {
  personaId: string | null;
  initialName: string;
  initialContent: PersonaContent | null;
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function PersonaForm({
  personaId,
  initialName,
  initialContent,
}: PersonaFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [audience, setAudience] = useState(initialContent?.audience ?? "");
  const [voice, setVoice] = useState(initialContent?.voice ?? "");
  const [pillarsRaw, setPillarsRaw] = useState(
    initialContent?.pillars.join(", ") ?? "",
  );
  const [goals, setGoals] = useState(initialContent?.goals ?? "");
  const [boundaries, setBoundaries] = useState(
    initialContent?.boundaries ?? "",
  );
  const [topicsRaw, setTopicsRaw] = useState(
    initialContent?.sampleTopics.join(", ") ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pillars = useMemo(() => splitList(pillarsRaw), [pillarsRaw]);
  const sampleTopics = useMemo(() => splitList(topicsRaw), [topicsRaw]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await savePersona(personaId, {
        name,
        audience,
        voice,
        pillars,
        goals,
        boundaries,
        sampleTopics,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save the persona. Try again.");
      } else if (res.unchanged) {
        toast.info("No changes to save", {
          description: "The persona already matches what you entered.",
        });
      } else {
        toast.success(
          personaId ? `Persona saved as v${res.version}` : "Persona created",
          {
            description: personaId
              ? "A new version was added — earlier versions stay untouched."
              : "This persona now guides idea relevance and script voice.",
          },
        );
        router.refresh();
      }
    } catch {
      setError("Something went wrong saving the persona. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          onSubmit={submit}
          className="space-y-5"
          aria-busy={pending}
          aria-label="Persona editor"
        >
          <div className="space-y-2">
            <Label htmlFor="persona-name">Name</Label>
            <Input
              id="persona-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Practical Builder"
              required
              maxLength={120}
            />
            <p className="text-muted-foreground text-xs">
              A short label so you recognize this persona later.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-audience">Audience</Label>
            <Textarea
              id="persona-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Who are you making videos for? Their role, level, and what they care about."
              required
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Used to judge whether an idea is relevant before it reaches your
              queue.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-voice">Voice &amp; tone</Label>
            <Textarea
              id="persona-voice"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              placeholder="e.g. Direct and warm. Short sentences. No hype words, no emojis."
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Scripts are drafted in this voice.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-pillars">Content pillars</Label>
            <Input
              id="persona-pillars"
              value={pillarsRaw}
              onChange={(e) => setPillarsRaw(e.target.value)}
              placeholder="e.g. build in public, growth tactics, tooling reviews"
            />
            <p className="text-muted-foreground text-xs">
              Comma-separated themes you keep returning to.
            </p>
            {pillars.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5"
                aria-label="Content pillars preview"
              >
                {pillars.map((p) => (
                  <Badge key={p} variant="secondary">
                    {p}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-goals">Goals</Label>
            <Textarea
              id="persona-goals"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="What should this content achieve — leads, authority, community?"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-boundaries">Boundaries</Label>
            <Textarea
              id="persona-boundaries"
              value={boundaries}
              onChange={(e) => setBoundaries(e.target.value)}
              placeholder="Things this persona never covers — topics, claims, or styles to avoid."
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Ideas that cross these lines are filtered out.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-topics">Sample topics</Label>
            <Input
              id="persona-topics"
              value={topicsRaw}
              onChange={(e) => setTopicsRaw(e.target.value)}
              placeholder="e.g. how I plan a launch week, my editing stack, pricing mistakes"
            />
            <p className="text-muted-foreground text-xs">
              Comma-separated examples of videos you&apos;d happily make.
            </p>
            {sampleTopics.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5"
                aria-label="Sample topics preview"
              >
                {sampleTopics.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t save the persona</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={pending || !name.trim() || !audience.trim()}
          >
            {pending
              ? "Saving…"
              : personaId
                ? "Save persona"
                : "Create persona"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
