import "server-only";
import { cache } from "react";
import {
  DEFAULT_BUDGET,
  evaluateBudget,
  type BudgetDecision,
  type BudgetSettings,
} from "@effen/core";
import { supabaseServer } from "@/lib/supabase/server";

export interface WorkspaceSettingsRow {
  daily_budget_usd: number | string;
  monthly_budget_usd: number | string;
  per_run_item_cap: number;
  per_run_charge_cap_usd: number | string;
  raw_media_retention_days: number;
  providers_enabled: Record<string, boolean> | null;
}

/** One settings row per request — the budget snapshot and the settings page share it. */
export const getWorkspaceSettingsRow = cache(
  async (workspaceId: string): Promise<WorkspaceSettingsRow | null> => {
    const supabase = await supabaseServer();
    const { data } = await supabase
      .from("workspace_settings")
      .select(
        "daily_budget_usd, monthly_budget_usd, per_run_item_cap, per_run_charge_cap_usd, raw_media_retention_days, providers_enabled",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return (data as WorkspaceSettingsRow | null) ?? null;
  },
);

export interface BudgetSnapshot {
  settings: BudgetSettings;
  spentTodayUsd: number;
  spentMonthUsd: number;
  runsThisMonth: number;
}

export async function getBudgetSnapshot(
  workspaceId: string,
): Promise<BudgetSnapshot> {
  const supabase = await supabaseServer();

  // Estimated cost is the enforcement basis; reported cost (when present)
  // refines it. The sums run as a DB aggregate instead of a row scan here.
  const [row, spendRes] = await Promise.all([
    getWorkspaceSettingsRow(workspaceId),
    supabase.rpc("workspace_spend", { ws: workspaceId }).maybeSingle(),
  ]);

  const settings: BudgetSettings = row
    ? {
        dailyUsd: Number(row.daily_budget_usd),
        monthlyUsd: Number(row.monthly_budget_usd),
        perRunItemCap: row.per_run_item_cap,
        perRunProviderChargeCapUsd: Number(row.per_run_charge_cap_usd),
      }
    : DEFAULT_BUDGET;

  const spend = spendRes.data as {
    spent_today: number | string;
    spent_month: number | string;
    runs_month: number;
  } | null;

  return {
    settings,
    spentTodayUsd: Number(spend?.spent_today ?? 0),
    spentMonthUsd: Number(spend?.spent_month ?? 0),
    runsThisMonth: Number(spend?.runs_month ?? 0),
  };
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
