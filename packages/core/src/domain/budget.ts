/**
 * Budget evaluation. Cost control is a P0 feature: every cost-incurring dispatch
 * calls `evaluateBudget` first and a blocked result must surface as a visible
 * `budget_blocked` state — never a silent drop.
 */

export interface BudgetSettings {
  dailyUsd: number;
  monthlyUsd: number;
  perRunItemCap: number;
  perRunProviderChargeCapUsd: number;
}

export const DEFAULT_BUDGET: BudgetSettings = {
  dailyUsd: 5,
  monthlyUsd: 50,
  perRunItemCap: 25,
  perRunProviderChargeCapUsd: 2,
};

export interface BudgetUsage {
  spentTodayUsd: number;
  spentMonthUsd: number;
}

export type BudgetDecision =
  | { allowed: true; remainingTodayUsd: number; remainingMonthUsd: number }
  | {
      allowed: false;
      reason:
        "daily_budget" | "monthly_budget" | "per_run_items" | "per_run_charge";
      detail: string;
    };

export function evaluateBudget(
  settings: BudgetSettings,
  usage: BudgetUsage,
  run: { estimatedUsd: number; itemCount: number },
): BudgetDecision {
  if (run.itemCount > settings.perRunItemCap) {
    return {
      allowed: false,
      reason: "per_run_items",
      detail: `Run of ${run.itemCount} items exceeds the per-run cap of ${settings.perRunItemCap}.`,
    };
  }
  if (run.estimatedUsd > settings.perRunProviderChargeCapUsd) {
    return {
      allowed: false,
      reason: "per_run_charge",
      detail: `Estimated $${run.estimatedUsd.toFixed(2)} exceeds the per-run charge cap of $${settings.perRunProviderChargeCapUsd.toFixed(2)}.`,
    };
  }
  if (usage.spentTodayUsd + run.estimatedUsd > settings.dailyUsd) {
    return {
      allowed: false,
      reason: "daily_budget",
      detail: `Estimated $${run.estimatedUsd.toFixed(2)} would exceed today's remaining budget of $${Math.max(0, settings.dailyUsd - usage.spentTodayUsd).toFixed(2)}.`,
    };
  }
  if (usage.spentMonthUsd + run.estimatedUsd > settings.monthlyUsd) {
    return {
      allowed: false,
      reason: "monthly_budget",
      detail: `Estimated $${run.estimatedUsd.toFixed(2)} would exceed this month's remaining budget of $${Math.max(0, settings.monthlyUsd - usage.spentMonthUsd).toFixed(2)}.`,
    };
  }
  return {
    allowed: true,
    remainingTodayUsd:
      settings.dailyUsd - usage.spentTodayUsd - run.estimatedUsd,
    remainingMonthUsd:
      settings.monthlyUsd - usage.spentMonthUsd - run.estimatedUsd,
  };
}
