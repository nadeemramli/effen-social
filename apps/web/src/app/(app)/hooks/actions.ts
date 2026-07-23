"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireWorkspace,
  assertWorkspaceRow,
  writeAudit,
} from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { HOOK_CATEGORIES } from "./categories";

export interface HookActionResult {
  ok: boolean;
  error?: string;
}

const hookFieldsSchema = z.object({
  mechanism: z
    .string()
    .trim()
    .min(
      10,
      "Describe the mechanism in at least 10 characters — what it does to the viewer, not the exact words.",
    ),
  category: z.enum(HOOK_CATEGORIES, {
    errorMap: () => ({ message: "Pick one of the hook categories." }),
  }),
  example: z
    .string()
    .trim()
    .max(500, "Keep the example under 500 characters.")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2,000 characters.")
    .optional(),
});

export type HookInput = z.infer<typeof hookFieldsSchema>;

const idSchema = z.string().uuid("Invalid hook id.");

export async function createHook(input: HookInput): Promise<HookActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const parsed = hookFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid hook.",
    };
  }

  const { error } = await supabase.from("hooks").insert({
    workspace_id: ws.workspaceId,
    mechanism: parsed.data.mechanism,
    category: parsed.data.category,
    example: parsed.data.example || null,
    notes: parsed.data.notes ?? "",
  });
  if (error) return { ok: false, error: error.message };

  await writeAudit(ws.workspaceId, ws.userId, "hook.create", {
    category: parsed.data.category,
  });
  revalidatePath("/hooks");
  return { ok: true };
}

export async function updateHook(
  id: string,
  input: HookInput,
): Promise<HookActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success)
    return {
      ok: false,
      error: parsedId.error.issues[0]?.message ?? "Invalid hook id.",
    };
  const parsed = hookFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid hook.",
    };
  }

  // Verify ownership before acting on a client-supplied id (RLS is the backstop).
  const { data: row } = await supabase
    .from("hooks")
    .select("id, workspace_id")
    .eq("id", parsedId.data)
    .maybeSingle();
  try {
    assertWorkspaceRow(row, ws.workspaceId);
  } catch {
    return { ok: false, error: "Hook not found in this workspace." };
  }

  const { error } = await supabase
    .from("hooks")
    .update({
      mechanism: parsed.data.mechanism,
      category: parsed.data.category,
      example: parsed.data.example || null,
      notes: parsed.data.notes ?? "",
    })
    .eq("id", parsedId.data)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(ws.workspaceId, ws.userId, "hook.update", {
    hookId: parsedId.data,
  });
  revalidatePath("/hooks");
  return { ok: true };
}

export async function deleteHook(id: string): Promise<HookActionResult> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success)
    return {
      ok: false,
      error: parsedId.error.issues[0]?.message ?? "Invalid hook id.",
    };

  const { data: row } = await supabase
    .from("hooks")
    .select("id, workspace_id")
    .eq("id", parsedId.data)
    .maybeSingle();
  try {
    assertWorkspaceRow(row, ws.workspaceId);
  } catch {
    return { ok: false, error: "Hook not found in this workspace." };
  }

  const { error } = await supabase
    .from("hooks")
    .delete()
    .eq("id", parsedId.data)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(ws.workspaceId, ws.userId, "hook.delete", {
    hookId: parsedId.data,
  });
  revalidatePath("/hooks");
  return { ok: true };
}
