"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";

export type IdeaStatus = "inbox" | "shortlisted" | "discarded" | "archived";

/** Allowed status moves: inbox fans out, discarded/archived only restore, shortlisted can go anywhere back. */
const TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  inbox: ["shortlisted", "discarded", "archived"],
  shortlisted: ["inbox", "archived", "discarded"],
  discarded: ["inbox"],
  archived: ["inbox"],
};

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function setIdeaStatus(
  ideaId: string,
  status: IdeaStatus,
): Promise<ActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, status")
    .eq("id", ideaId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!idea) return { ok: false, error: "Idea not found." };

  const current = idea.status as IdeaStatus;
  if (current === status) return { ok: true };
  if (!TRANSITIONS[current]?.includes(status)) {
    return {
      ok: false,
      error: `An idea can't move from ${current} to ${status}.`,
    };
  }

  const { error } = await supabase
    .from("ideas")
    .update({ status })
    .eq("id", ideaId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/ideas");
  return { ok: true };
}

/** Updates ONLY the user-authored notes column — analyses never touch it. */
export async function saveNotes(
  ideaId: string,
  notes: string,
): Promise<ActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id")
    .eq("id", ideaId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!idea) return { ok: false, error: "Idea not found." };

  const { error } = await supabase
    .from("ideas")
    .update({ notes })
    .eq("id", ideaId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/ideas");
  return { ok: true };
}

export interface ConvertResult {
  ok: boolean;
  scriptId?: string;
  existing?: boolean;
  error?: string;
}

/**
 * Create a draft script seeded from the idea, or return the idea's existing
 * script so re-clicking never produces duplicates.
 */
export async function convertToScript(ideaId: string): Promise<ConvertResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, angle, persona_relevance, status")
    .eq("id", ideaId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!idea) return { ok: false, error: "Idea not found." };

  const shortlistIfInbox = async () => {
    if (idea.status === "inbox") {
      await supabase
        .from("ideas")
        .update({ status: "shortlisted" })
        .eq("id", ideaId)
        .eq("workspace_id", ws.workspaceId);
    }
  };

  const { data: existingScript } = await supabase
    .from("scripts")
    .select("id")
    .eq("workspace_id", ws.workspaceId)
    .eq("idea_id", ideaId)
    .limit(1)
    .maybeSingle();
  if (existingScript) {
    await shortlistIfInbox();
    revalidatePath("/ideas");
    return { ok: true, scriptId: existingScript.id as string, existing: true };
  }

  const { data: created, error } = await supabase
    .from("scripts")
    .insert({
      workspace_id: ws.workspaceId,
      idea_id: ideaId,
      title: idea.title,
      status: "draft",
      stage: "topic",
      topic: {
        topic: idea.title,
        angle: idea.angle,
        audience: idea.persona_relevance ?? "",
        notes: "",
      },
    })
    .select("id")
    .single();
  if (error || !created)
    return {
      ok: false,
      error: error?.message ?? "Could not create the script.",
    };

  await shortlistIfInbox();
  await writeAudit(ws.workspaceId, ws.userId, "idea.convert_to_script", {
    ideaId,
    scriptId: created.id,
  });
  revalidatePath("/ideas");
  return { ok: true, scriptId: created.id as string };
}
