"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  mockHooks,
  mockRegenerateSection,
  mockResearch,
  mockReviseScript,
  mockScript,
  researchV1Schema,
  scriptV1Schema,
  SCRIPT_STATUSES,
  type ScriptStatus,
  type ScriptV1,
} from "@effen/core";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { checkBudget } from "@/lib/budget";
import { recordAiRun, roughTokens } from "@/lib/ai/service";

async function getScript(scriptId: string) {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data: script } = await supabase
    .from("scripts")
    .select("*")
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (!script) throw new Error("Script not found");
  return { ws, supabase, script };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  blocked?: string;
}

const topicSchema = z.object({
  topic: z.string().min(3, "Give the topic a few words"),
  angle: z.string().default(""),
  audience: z.string().default(""),
  notes: z.string().default(""),
});

export async function saveTopic(
  scriptId: string,
  input: unknown,
): Promise<ActionResult> {
  const parsed = topicSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid topic",
    };
  const { ws, supabase } = await getScript(scriptId);
  const { error } = await supabase
    .from("scripts")
    .update({ topic: parsed.data, title: parsed.data.topic.slice(0, 120) })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/scripts/${scriptId}/wizard`);
  return { ok: true };
}

export async function setStage(
  scriptId: string,
  stage: "topic" | "research" | "hook" | "script",
): Promise<ActionResult> {
  const { ws, supabase } = await getScript(scriptId);
  // Moving backward never clears saved data — stage is just the cursor.
  const { error } = await supabase
    .from("scripts")
    .update({ stage })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/scripts/${scriptId}/wizard`);
  return { ok: true };
}

export async function runResearch(scriptId: string): Promise<ActionResult> {
  const { ws, supabase, script } = await getScript(scriptId);
  const topic = (script.topic as { topic?: string } | null)?.topic;
  if (!topic) return { ok: false, error: "Save a topic first." };

  const estTokens = roughTokens(topic) + 2500;
  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd: (estTokens / 1e6) * 2.5,
    itemCount: 1,
  });
  if (!decision.allowed) return { ok: false, blocked: decision.detail };

  const started = Date.now();
  const research = mockResearch(scriptId, topic);
  const { error } = await supabase
    .from("scripts")
    .update({ research, stage: "research" })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  await recordAiRun({
    workspaceId: ws.workspaceId,
    operation: "research",
    promptTemplate: "research.v1",
    outputSchemaVersion: 1,
    scriptId,
    inputTokens: estTokens,
    outputTokens: roughTokens(JSON.stringify(research)),
    latencyMs: Date.now() - started,
    status: "succeeded",
  });
  revalidatePath(`/scripts/${scriptId}/wizard`);
  return { ok: true };
}

export async function runHooks(scriptId: string): Promise<ActionResult> {
  const { ws, supabase, script } = await getScript(scriptId);
  const topic = (script.topic as { topic?: string } | null)?.topic;
  if (!topic) return { ok: false, error: "Save a topic first." };

  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd: 0.01,
    itemCount: 1,
  });
  if (!decision.allowed) return { ok: false, blocked: decision.detail };

  const started = Date.now();
  const hooks = mockHooks(scriptId, topic);
  const existing = (script.hook as { selected?: unknown } | null) ?? {};
  const { error } = await supabase
    .from("scripts")
    .update({ hook: { ...existing, options: hooks.options }, stage: "hook" })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  await recordAiRun({
    workspaceId: ws.workspaceId,
    operation: "hook_generation",
    promptTemplate: "hooks.v1",
    outputSchemaVersion: 1,
    scriptId,
    inputTokens: roughTokens(topic) + 800,
    outputTokens: roughTokens(JSON.stringify(hooks)),
    latencyMs: Date.now() - started,
    status: "succeeded",
  });
  revalidatePath(`/scripts/${scriptId}/wizard`);
  return { ok: true };
}

export async function chooseHook(
  scriptId: string,
  hookText: string,
): Promise<ActionResult> {
  if (!hookText.trim())
    return { ok: false, error: "Pick or write a hook first." };
  const { ws, supabase, script } = await getScript(scriptId);
  const existing = (script.hook as Record<string, unknown> | null) ?? {};
  const { error } = await supabase
    .from("scripts")
    .update({ hook: { ...existing, selected: hookText.trim() } })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/scripts/${scriptId}/wizard`);
  return { ok: true };
}

export async function generateScript(scriptId: string): Promise<ActionResult> {
  const { ws, supabase, script } = await getScript(scriptId);
  const topic = (script.topic as { topic?: string } | null)?.topic;
  const selected = (script.hook as { selected?: string } | null)?.selected;
  if (!topic) return { ok: false, error: "Save a topic first." };
  if (!selected)
    return { ok: false, error: "Choose a hook before drafting the script." };

  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd: 0.05,
    itemCount: 1,
  });
  if (!decision.allowed) return { ok: false, blocked: decision.detail };

  const started = Date.now();
  const version = (script.current_version as number) + 1;
  const content = mockScript({
    seed: `${scriptId}:v${version}`,
    topic,
    hookText: selected,
  });

  const { error: vErr } = await supabase.from("script_versions").insert({
    script_id: scriptId,
    workspace_id: ws.workspaceId,
    version,
    content,
    created_by: "ai",
    label: version === 1 ? "first draft" : "redraft",
  });
  if (vErr) return { ok: false, error: vErr.message };
  const { error } = await supabase
    .from("scripts")
    .update({
      current_version: version,
      stage: "script",
      status: script.status === "draft" ? "draft" : script.status,
    })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  await recordAiRun({
    workspaceId: ws.workspaceId,
    operation: "script_writing",
    promptTemplate: "script.v1",
    outputSchemaVersion: 1,
    scriptId,
    inputTokens:
      roughTokens(JSON.stringify(script.research ?? "")) +
      roughTokens(topic) +
      1200,
    outputTokens: roughTokens(JSON.stringify(content)),
    latencyMs: Date.now() - started,
    status: "succeeded",
  });
  revalidatePath(`/scripts/${scriptId}`);
  revalidatePath(`/scripts/${scriptId}/wizard`);
  return { ok: true };
}

/** Autosave direct edits as a `user` version; consecutive autosaves collapse into one. */
export async function saveDraft(
  scriptId: string,
  content: unknown,
): Promise<ActionResult> {
  const parsed = scriptV1Schema.safeParse(content);
  if (!parsed.success)
    return { ok: false, error: "Draft failed validation — not saved." };
  const { ws, supabase, script } = await getScript(scriptId);

  const { data: latest } = await supabase
    .from("script_versions")
    .select("id, version, created_by, label")
    .eq("script_id", scriptId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && latest.created_by === "user" && latest.label === "autosave") {
    const { error } = await supabase
      .from("script_versions")
      .update({ content: parsed.data })
      .eq("id", latest.id)
      .eq("workspace_id", ws.workspaceId);
    if (error) return { ok: false, error: error.message };
  } else {
    const version =
      ((latest?.version as number | undefined) ?? script.current_version ?? 0) +
      1;
    const { error } = await supabase.from("script_versions").insert({
      script_id: scriptId,
      workspace_id: ws.workspaceId,
      version,
      content: parsed.data,
      created_by: "user",
      label: "autosave",
    });
    if (error) return { ok: false, error: error.message };
    await supabase
      .from("scripts")
      .update({ current_version: version })
      .eq("id", scriptId)
      .eq("workspace_id", ws.workspaceId);
  }
  return { ok: true };
}

/** Targeted natural-language revision → a NEW ai version; the previous version stays. */
export async function reviseScript(
  scriptId: string,
  instruction: string,
): Promise<ActionResult> {
  if (instruction.trim().length < 5)
    return { ok: false, error: "Describe the revision in a few words." };
  const { ws, supabase } = await getScript(scriptId);
  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd: 0.05,
    itemCount: 1,
  });
  if (!decision.allowed) return { ok: false, blocked: decision.detail };

  const { data: latest } = await supabase
    .from("script_versions")
    .select("version, content")
    .eq("script_id", scriptId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { ok: false, error: "No draft to revise yet." };
  const current = scriptV1Schema.parse(latest.content);

  const started = Date.now();
  const revised = mockReviseScript(
    `${scriptId}:${latest.version}`,
    current,
    instruction,
  );
  const version = (latest.version as number) + 1;
  const { error } = await supabase.from("script_versions").insert({
    script_id: scriptId,
    workspace_id: ws.workspaceId,
    version,
    content: revised,
    created_by: "ai",
    label: `revision: ${instruction.slice(0, 40)}`,
  });
  if (error) return { ok: false, error: error.message };
  await supabase
    .from("scripts")
    .update({ current_version: version, status: "revising" })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  await recordAiRun({
    workspaceId: ws.workspaceId,
    operation: "script_revision",
    promptTemplate: "script-revision.v1",
    outputSchemaVersion: 1,
    scriptId,
    inputTokens:
      roughTokens(JSON.stringify(current)) + roughTokens(instruction),
    outputTokens: roughTokens(JSON.stringify(revised)),
    latencyMs: Date.now() - started,
    status: "succeeded",
  });
  revalidatePath(`/scripts/${scriptId}`);
  return { ok: true };
}

/** Regenerate ONE section; every other section is byte-identical in the new version. */
export async function regenerateSection(
  scriptId: string,
  sectionId: string,
): Promise<ActionResult> {
  const { ws, supabase } = await getScript(scriptId);
  const decision = await checkBudget(ws.workspaceId, {
    estimatedUsd: 0.02,
    itemCount: 1,
  });
  if (!decision.allowed) return { ok: false, blocked: decision.detail };

  const { data: latest } = await supabase
    .from("script_versions")
    .select("version, content")
    .eq("script_id", scriptId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { ok: false, error: "No draft yet." };
  const current = scriptV1Schema.parse(latest.content);
  if (!current.sections.some((s) => s.id === sectionId))
    return { ok: false, error: "Section not found." };

  const started = Date.now();
  const next = mockRegenerateSection(
    `${scriptId}:${latest.version}`,
    current,
    sectionId,
  );
  const version = (latest.version as number) + 1;
  const { error } = await supabase.from("script_versions").insert({
    script_id: scriptId,
    workspace_id: ws.workspaceId,
    version,
    content: next,
    created_by: "ai",
    label: `regenerated ${sectionId}`,
  });
  if (error) return { ok: false, error: error.message };
  await supabase
    .from("scripts")
    .update({ current_version: version })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  await recordAiRun({
    workspaceId: ws.workspaceId,
    operation: "script_writing",
    promptTemplate: "script.v1",
    outputSchemaVersion: 1,
    scriptId,
    inputTokens: roughTokens(JSON.stringify(current)),
    outputTokens: roughTokens(
      JSON.stringify(
        next.sections.find((s) => s.id === sectionId)?.content ?? "",
      ),
    ),
    latencyMs: Date.now() - started,
    status: "succeeded",
  });
  revalidatePath(`/scripts/${scriptId}`);
  return { ok: true };
}

export async function restoreVersion(
  scriptId: string,
  version: number,
): Promise<ActionResult> {
  const { ws, supabase } = await getScript(scriptId);
  const { data: target } = await supabase
    .from("script_versions")
    .select("content")
    .eq("script_id", scriptId)
    .eq("version", version)
    .maybeSingle();
  if (!target) return { ok: false, error: "Version not found." };
  const { data: latest } = await supabase
    .from("script_versions")
    .select("version")
    .eq("script_id", scriptId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newVersion = ((latest?.version as number | undefined) ?? 0) + 1;
  const { error } = await supabase.from("script_versions").insert({
    script_id: scriptId,
    workspace_id: ws.workspaceId,
    version: newVersion,
    content: target.content,
    created_by: "user",
    label: `restored v${version}`,
  });
  if (error) return { ok: false, error: error.message };
  await supabase
    .from("scripts")
    .update({ current_version: newVersion })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  revalidatePath(`/scripts/${scriptId}`);
  return { ok: true };
}

/** Status changes are always explicit user actions — never automatic. */
export async function setScriptStatus(
  scriptId: string,
  status: ScriptStatus,
): Promise<ActionResult> {
  if (!SCRIPT_STATUSES.includes(status))
    return { ok: false, error: "Unknown status." };
  const { ws, supabase } = await getScript(scriptId);
  const { error } = await supabase
    .from("scripts")
    .update({ status })
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  await writeAudit(ws.workspaceId, ws.userId, "script.status", {
    scriptId,
    status,
  });
  revalidatePath("/scripts");
  revalidatePath(`/scripts/${scriptId}`);
  return { ok: true };
}

export async function createBlankScript(): Promise<{
  ok: boolean;
  scriptId?: string;
  error?: string;
}> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("scripts")
    .insert({
      workspace_id: ws.workspaceId,
      title: "Untitled script",
      status: "draft",
      stage: "topic",
    })
    .select("id")
    .single();
  if (error || !data)
    return { ok: false, error: error?.message ?? "Could not create script." };
  return { ok: true, scriptId: data.id };
}

export async function deleteScript(scriptId: string): Promise<ActionResult> {
  const { ws, supabase } = await getScript(scriptId);
  const { error } = await supabase
    .from("scripts")
    .delete()
    .eq("id", scriptId)
    .eq("workspace_id", ws.workspaceId);
  if (error) return { ok: false, error: error.message };
  await writeAudit(ws.workspaceId, ws.userId, "script.delete", { scriptId });
  revalidatePath("/scripts");
  return { ok: true };
}

/** Parse helpers shared by wizard/editor server pages. */
export async function loadScriptBundle(scriptId: string) {
  const { ws, supabase, script } = await getScript(scriptId);
  const { data: versions } = await supabase
    .from("script_versions")
    .select("version, content, created_by, label, created_at")
    .eq("script_id", scriptId)
    .order("version", { ascending: false });
  const parsedVersions = (versions ?? []).flatMap((v) => {
    const parsed = scriptV1Schema.safeParse(v.content);
    return parsed.success
      ? [
          {
            version: v.version as number,
            content: parsed.data satisfies ScriptV1,
            createdBy: v.created_by as "ai" | "user",
            label: (v.label ?? null) as string | null,
            createdAt: v.created_at as string,
          },
        ]
      : [];
  });
  const research = script.research
    ? researchV1Schema.safeParse(script.research)
    : null;
  return {
    workspaceId: ws.workspaceId,
    script,
    versions: parsedVersions,
    research: research?.success ? research.data : null,
  };
}
