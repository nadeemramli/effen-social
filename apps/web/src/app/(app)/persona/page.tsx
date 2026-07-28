import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { parsePersonaContent, type PersonaContent } from "./schema";
import { PersonaForm } from "./persona-form";
import { VersionHistory, type VersionRow } from "./version-history";

export const metadata = { title: "Persona — EFFEN Studio" };

export default async function PersonaPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: personas } = await supabase
    .from("personas")
    .select("id, name, current_version, is_default, created_at")
    .eq("workspace_id", ws.workspaceId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  const persona = personas?.[0] ?? null;

  let versions: VersionRow[] = [];
  let currentContent: PersonaContent | null = null;
  if (persona) {
    // The list only needs metadata; full content is fetched for the current
    // version alone (old versions load on demand in the history dialog).
    const [{ data: versionRows }, { data: currentRow }] = await Promise.all([
      supabase
        .from("persona_versions")
        .select("id, version, created_at")
        .eq("persona_id", persona.id)
        .eq("workspace_id", ws.workspaceId)
        .order("version", { ascending: false }),
      supabase
        .from("persona_versions")
        .select("content")
        .eq("persona_id", persona.id)
        .eq("workspace_id", ws.workspaceId)
        .eq("version", persona.current_version)
        .maybeSingle(),
    ]);
    versions = (versionRows ?? []).map((v) => ({
      id: v.id as string,
      version: v.version as number,
      createdAt: v.created_at as string,
    }));
    currentContent = currentRow ? parsePersonaContent(currentRow.content) : null;
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Persona</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {persona
            ? `${persona.name} · v${persona.current_version} · ${versions.length} version${versions.length === 1 ? "" : "s"}`
            : "Define who you make videos for and how you sound."}
        </p>
      </div>

      {!persona && (
        <div className="border-border mt-10 rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-lg font-semibold">
            Create your persona
          </p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            Your persona is the lens every idea passes through: it decides which
            trends are relevant to your audience and gives scripts a consistent
            voice. Fill in the form below — every save is versioned, so you can
            evolve it without losing where you started.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <PersonaForm
          personaId={persona?.id ?? null}
          initialName={persona?.name ?? ""}
          initialContent={currentContent}
        />

        {persona && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Version history</CardTitle>
              <CardDescription>
                Every save creates a new version. Restoring copies an old
                version forward — nothing is ever rewritten.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VersionHistory
                personaId={persona.id}
                currentVersion={persona.current_version}
                versions={versions}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
