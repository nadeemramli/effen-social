"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { updateBudget } from "./actions";

export interface BudgetFormValues {
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  perRunItemCap: number;
  perRunChargeCapUsd: number;
  rawMediaRetentionDays: number;
}

interface FieldDef {
  name: keyof BudgetFormValues;
  label: string;
  hint: string;
  min: number;
  step: number;
}

const FIELDS: FieldDef[] = [
  {
    name: "dailyBudgetUsd",
    label: "Daily budget (USD)",
    hint: "Hard cap on estimated spend per UTC day.",
    min: 0,
    step: 0.01,
  },
  {
    name: "monthlyBudgetUsd",
    label: "Monthly budget (USD)",
    hint: "Hard cap on estimated spend per calendar month.",
    min: 0,
    step: 1,
  },
  {
    name: "perRunItemCap",
    label: "Per-run item cap",
    hint: "Maximum videos in a single analysis run.",
    min: 1,
    step: 1,
  },
  {
    name: "perRunChargeCapUsd",
    label: "Per-run provider charge cap (USD)",
    hint: "A single run may not exceed this estimated cost.",
    min: 0,
    step: 0.01,
  },
  {
    name: "rawMediaRetentionDays",
    label: "Raw media retention (days)",
    hint: "Downloaded originals are deleted after this many days. 0 = keep forever.",
    min: 0,
    step: 1,
  },
];

export function BudgetForm({ initial }: { initial: BudgetFormValues }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {} as BudgetFormValues;
    for (const field of FIELDS) {
      const raw = form.get(field.name);
      const num = Number(raw);
      if (raw === null || raw === "" || Number.isNaN(num)) {
        setError(`"${field.label}" must be a number.`);
        return;
      }
      values[field.name] = num;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateBudget(values);
      if (res.ok) {
        toast.success("Budget settings saved");
        router.refresh();
      } else {
        setError(res.error ?? "Could not save budget settings.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={`budget-${field.name}`}>{field.label}</Label>
            <Input
              id={`budget-${field.name}`}
              name={field.name}
              type="number"
              inputMode="decimal"
              min={field.min}
              step={field.step}
              defaultValue={initial[field.name]}
              required
            />
            <p className="text-muted-foreground text-xs">{field.hint}</p>
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save budget settings"}
      </Button>
    </form>
  );
}
