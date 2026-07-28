"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import {
  parsePersonaContent,
  personaInputSchema,
  type PersonaContent,
  type PersonaInput,
} from "./schema";

export interface SavePersonaResult {
  ok: boolean;
  personaId?: string;
  version?: number;
  /** True when nothing changed, so no new version was written. */
  unchanged?: boolean;
  error?: string;
}

export async function savePersona(
  personaId: string | null,
  input: PersonaInput,
): Promise<SavePersonaResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const parsed = personaInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }
  const { name } = parsed.data;
  const content: PersonaContent = {
    audience: parsed.data.audience,
    voice: parsed.data.voice,
    pillars: parsed.data.pillars,
    goals: parsed.data.goals,
    boundaries: parsed.data.boundaries,
    sampleTopics: parsed.data.sampleTopics,
  };

  // First save: create the persona and its v1 in one go.
  if (!personaId) {
    const { data: created, error: insertError } = await supabase
      .from("personas")
      .insert({
        workspace_id: ws.workspaceId,
        name,
        current_version: 1,
        is_default: true,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return {
        ok: false,
        error: insertError?.message ?? "Could not create the persona.",
      };
    }
    const newId = created.id as string;

    const { error: versionError } = await supabase
      .from("persona_versions")
      .insert({
        persona_id: newId,
        workspace_id: ws.workspaceId,
        version: 1,
        content,
      });
    if (versionError) return { ok: false, error: versionError.message };

    await writeAudit(ws.workspaceId, ws.userId, "persona.update", {
      personaId: newId,
      version: 1,
    });
    revalidatePath("/persona");
    return { ok: true, personaId: newId, version: 1 };
  }

  // Subsequent save: append a new immutable version only when content changed.
  const { data: persona } = await supabase
    .from("personas")
    .select("id, workspace_id, name, current_version")
    .eq("id", personaId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!persona) return { ok: false, error: "Persona not found." };

  const { data: currentRow } = await supabase
    .from("persona_versions")
    .select("content")
    .eq("persona_id", persona.id)
    .eq("workspace_id", ws.workspaceId)
    .eq("version", persona.current_version)
    .maybeSingle();

  const currentContent = currentRow
    ? parsePersonaContent(currentRow.content)
    : null;
  const contentChanged =
    !currentContent ||
    JSON.stringify(currentContent) !== JSON.stringify(content);
  const nameChanged = persona.name !== name;

  if (!contentChanged && !nameChanged) {
    return {
      ok: true,
      personaId: persona.id,
      version: persona.current_version,
      unchanged: true,
    };
  }

  if (!contentChanged) {
    // Name-only edit: versions record content, not labels — just rename.
    const { error: renameError } = await supabase
      .from("personas")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", persona.id)
      .eq("workspace_id", ws.workspaceId);
    if (renameError) return { ok: false, error: renameError.message };

    await writeAudit(ws.workspaceId, ws.userId, "persona.update", {
      personaId: persona.id,
      version: persona.current_version,
    });
    revalidatePath("/persona");
    return {
      ok: true,
      personaId: persona.id,
      version: persona.current_version,
    };
  }

  const nextVersion = persona.current_version + 1;
  const { error: versionError } = await supabase
    .from("persona_versions")
    .insert({
      persona_id: persona.id,
      workspace_id: ws.workspaceId,
      version: nextVersion,
      content,
    });
  if (versionError) {
    if (versionError.code === "23505") {
      return {
        ok: false,
        error:
          "This persona was updated elsewhere. Reload the page and try again.",
      };
    }
    return { ok: false, error: versionError.message };
  }

  const { error: updateError } = await supabase
    .from("personas")
    .update({
      name,
      current_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", persona.id)
    .eq("workspace_id", ws.workspaceId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit(ws.workspaceId, ws.userId, "persona.update", {
    personaId: persona.id,
    version: nextVersion,
  });
  revalidatePath("/persona");
  return { ok: true, personaId: persona.id, version: nextVersion };
}

export async function getPersonaVersionContent(
  personaId: string,
  version: number,
): Promise<{ ok: boolean; content?: PersonaContent; error?: string }> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("persona_versions")
    .select("content")
    .eq("persona_id", personaId)
    .eq("workspace_id", ws.workspaceId)
    .eq("version", version)
    .maybeSingle();
  if (!data) return { ok: false, error: `Version ${version} was not found.` };
  return { ok: true, content: parsePersonaContent(data.content) };
}

export async function restorePersonaVersion(
  personaId: string,
  version: number,
): Promise<SavePersonaResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: persona } = await supabase
    .from("personas")
    .select("id, workspace_id, name, current_version")
    .eq("id", personaId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!persona) return { ok: false, error: "Persona not found." };

  if (version === persona.current_version) {
    return { ok: true, personaId: persona.id, version, unchanged: true };
  }

  const { data: source } = await supabase
    .from("persona_versions")
    .select("content")
    .eq("persona_id", persona.id)
    .eq("workspace_id", ws.workspaceId)
    .eq("version", version)
    .maybeSingle();
  if (!source) return { ok: false, error: `Version ${version} was not found.` };

  // Restore is append-only: copy the old content into a brand-new version.
  const nextVersion = persona.current_version + 1;
  const { error: versionError } = await supabase
    .from("persona_versions")
    .insert({
      persona_id: persona.id,
      workspace_id: ws.workspaceId,
      version: nextVersion,
      content: parsePersonaContent(source.content),
    });
  if (versionError) {
    if (versionError.code === "23505") {
      return {
        ok: false,
        error:
          "This persona was updated elsewhere. Reload the page and try again.",
      };
    }
    return { ok: false, error: versionError.message };
  }

  const { error: updateError } = await supabase
    .from("personas")
    .update({
      current_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", persona.id)
    .eq("workspace_id", ws.workspaceId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit(ws.workspaceId, ws.userId, "persona.update", {
    personaId: persona.id,
    version: nextVersion,
    restoredFrom: version,
  });
  revalidatePath("/persona");
  return { ok: true, personaId: persona.id, version: nextVersion };
}
