import "server-only";
import {
  DEFAULT_BUDGET,
  evaluateBudget,
  type BudgetDecision,
  type BudgetSettings,
} from "@effen/core";
import { supabaseServer } from "@/lib/supabase/server";

export interface BudgetSnapshot {
  settings: BudgetSettings;
  spentTodayUsd: number;
  spentMonthUsd: number;
}

export async function getBudgetSnapshot(
  workspaceId: string,
): Promise<BudgetSnapshot> {
  const supabase = await supabaseServer();

  const { data: row } = await supabase
    .from("workspace_settings")
    .select(
      "daily_budget_usd, monthly_budget_usd, per_run_item_cap, per_run_charge_cap_usd",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const settings: BudgetSettings = row
    ? {
        dailyUsd: Number(row.daily_budget_usd),
        monthlyUsd: Number(row.monthly_budget_usd),
        perRunItemCap: row.per_run_item_cap,
        perRunProviderChargeCapUsd: Number(row.per_run_charge_cap_usd),
      }
    : DEFAULT_BUDGET;

  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  // Estimated cost is the enforcement basis; reported cost (when present) refines display.
  const { data: monthRows } = await supabase
    .from("ai_runs")
    .select("estimated_cost_usd, reported_cost_usd, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart);

  let spentTodayUsd = 0;
  let spentMonthUsd = 0;
  for (const r of monthRows ?? []) {
    const cost = Number(r.reported_cost_usd ?? r.estimated_cost_usd ?? 0);
    spentMonthUsd += cost;
    if (r.created_at >= dayStart) spentTodayUsd += cost;
  }
  return { settings, spentTodayUsd, spentMonthUsd };
}

export async function checkBudget(
  workspaceId: string,
  run: { estimatedUsd: number; itemCount: number },
): Promise<BudgetDecision> {
  const snapshot = await getBudgetSnapshot(workspaceId);
  return evaluateBudget(
    snapshot.settings,
    {
      spentTodayUsd: snapshot.spentTodayUsd,
      spentMonthUsd: snapshot.spentMonthUsd,
    },
    run,
  );
}
