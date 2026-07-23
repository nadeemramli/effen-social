"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace, writeAudit } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const budgetSchema = z.object({
  dailyBudgetUsd: z.number().min(0, "Daily budget must be at least $0."),
  monthlyBudgetUsd: z.number().min(0, "Monthly budget must be at least $0."),
  perRunItemCap: z
    .number()
    .int("Item cap must be a whole number.")
    .min(1, "Item cap must be at least 1."),
  perRunChargeCapUsd: z
    .number()
    .min(0, "Per-run charge cap must be at least $0."),
  rawMediaRetentionDays: z
    .number()
    .int("Retention days must be a whole number.")
    .min(0, "Retention days must be at least 0 (0 = keep forever)."),
});

export type BudgetInput = z.infer<typeof budgetSchema>;

export async function updateBudget(input: BudgetInput): Promise<ActionResult> {
  const ws = await requireWorkspace();

  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid budget values.",
    };
  }
  const values = parsed.data;

  const supabase = await supabaseServer();
  const { data: current, error: readError } = await supabase
    .from("workspace_settings")
    .select(
      "daily_budget_usd, monthly_budget_usd, per_run_item_cap, per_run_charge_cap_usd, raw_media_retention_days",
    )
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (readError || !current) {
    return {
      ok: false,
      error: readError?.message ?? "Workspace settings not found.",
    };
  }

  const next = {
    daily_budget_usd: values.dailyBudgetUsd,
    monthly_budget_usd: values.monthlyBudgetUsd,
    per_run_item_cap: values.perRunItemCap,
    per_run_charge_cap_usd: values.perRunChargeCapUsd,
    raw_media_retention_days: values.rawMediaRetentionDays,
  };

  const changed: Record<string, { from: number; to: number }> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    const from = Number(current[key]);
    const to = next[key];
    if (from !== to) changed[key] = { from, to };
  }
  if (Object.keys(changed).length === 0) return { ok: true };

  const { error: updateError } = await supabase
    .from("workspace_settings")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.workspaceId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit(ws.workspaceId, ws.userId, "settings.budget_update", {
    changed,
  });
  revalidatePath("/settings");
  return { ok: true };
}

const TOGGLEABLE_PROVIDERS = [
  "youtube_official",
  "instagram_apify",
  "tiktok_apify",
] as const;
export type ToggleableProvider = (typeof TOGGLEABLE_PROVIDERS)[number];

export async function toggleProvider(
  key: ToggleableProvider,
  enabled: boolean,
): Promise<ActionResult> {
  const ws = await requireWorkspace();

  if (!(TOGGLEABLE_PROVIDERS as readonly string[]).includes(key)) {
    return { ok: false, error: "That provider cannot be toggled." };
  }

  const supabase = await supabaseServer();
  const { data: current, error: readError } = await supabase
    .from("workspace_settings")
    .select("providers_enabled")
    .eq("workspace_id", ws.workspaceId)
    .maybeSingle();
  if (readError || !current) {
    return {
      ok: false,
      error: readError?.message ?? "Workspace settings not found.",
    };
  }

  const providers = {
    ...((current.providers_enabled ?? {}) as Record<string, boolean>),
    manual_upload: true, // always on
    [key]: enabled,
  };

  const { error: updateError } = await supabase
    .from("workspace_settings")
    .update({
      providers_enabled: providers,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ws.workspaceId);
  if (updateError) return { ok: false, error: updateError.message };

  await writeAudit(ws.workspaceId, ws.userId, "provider.toggle", {
    provider: key,
    enabled,
  });
  revalidatePath("/settings");
  return { ok: true };
}
