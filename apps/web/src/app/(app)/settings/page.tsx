import { requireWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";
import { getBudgetSnapshot, getWorkspaceSettingsRow } from "@/lib/budget";
import { isMockMode } from "@/lib/env";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BudgetForm } from "./budget-form";
import { ProviderToggles, type ProvidersState } from "./provider-toggles";

export const metadata = { title: "Usage & budget — EFFEN Studio" };

const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface AiRunRow {
  id: string;
  operation: string;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  reported_cost_usd: number | null;
  latency_ms: number | null;
  status: "succeeded" | "failed";
  error: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

function StatBlock({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub: string;
  pct?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>
      {pct != null && (
        <Progress
          value={Math.min(100, pct)}
          className="mt-3"
          aria-label={`${label} consumption`}
        />
      )}
    </div>
  );
}

function compactDetail(detail: Record<string, unknown> | null): string {
  if (!detail || Object.keys(detail).length === 0) return "—";
  const text = JSON.stringify(detail);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export default async function SettingsPage() {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const mock = isMockMode();

  // getWorkspaceSettingsRow is request-cached, so the snapshot and this page
  // share one settings query; run counts come from the spend aggregate.
  const [snapshot, settingsRow, runsRes, auditRes] = await Promise.all([
    getBudgetSnapshot(ws.workspaceId),
    getWorkspaceSettingsRow(ws.workspaceId),
    supabase
      .from("ai_runs")
      .select(
        "id, operation, provider, model, input_tokens, output_tokens, estimated_cost_usd, reported_cost_usd, latency_ms, status, error, created_at",
      )
      .eq("workspace_id", ws.workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("audit_log")
      .select("id, action, detail, created_at")
      .eq("workspace_id", ws.workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const providers: ProvidersState = {
    manual_upload: true,
    youtube_official: true,
    instagram_apify: false,
    tiktok_apify: false,
    ...((settingsRow?.providers_enabled ?? {}) as Partial<ProvidersState>),
  };
  const retentionDays = settingsRow?.raw_media_retention_days ?? 0;
  const runs = (runsRes.data ?? []) as AiRunRow[];
  const auditEvents = (auditRes.data ?? []) as AuditRow[];
  const runsThisMonth = snapshot.runsThisMonth;

  const dailyPct =
    snapshot.settings.dailyUsd > 0
      ? (snapshot.spentTodayUsd / snapshot.settings.dailyUsd) * 100
      : 0;
  const monthlyPct =
    snapshot.settings.monthlyUsd > 0
      ? (snapshot.spentMonthUsd / snapshot.settings.monthlyUsd) * 100
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage &amp; budget</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Spend caps, provider access, and the run-by-run cost ledger for{" "}
          {ws.workspaceName}.
        </p>
      </div>

      {mock && (
        <Alert>
          <AlertTitle>Mock mode</AlertTitle>
          <AlertDescription>
            This workspace runs in mock mode: no real provider calls are made
            and actual spend is $0. Budgets still gate operations using
            live-price estimates, so blocked runs behave exactly as they would
            in live mode.
          </AlertDescription>
        </Alert>
      )}

      <section
        aria-label="Usage summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <StatBlock
          label="Spent today"
          value={usd(snapshot.spentTodayUsd)}
          sub={`of ${usd(snapshot.settings.dailyUsd)} daily budget`}
          pct={dailyPct}
        />
        <StatBlock
          label="Spent this month"
          value={usd(snapshot.spentMonthUsd)}
          sub={`of ${usd(snapshot.settings.monthlyUsd)} monthly budget`}
          pct={monthlyPct}
        />
        <StatBlock
          label="Runs this month"
          value={compact.format(runsThisMonth)}
          sub="AI runs recorded in the ledger"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Budget controls</CardTitle>
          <CardDescription>
            Every cost-incurring operation is checked against these caps before
            it runs. Blocked runs are surfaced — nothing is queued or spent
            silently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetForm
            initial={{
              dailyBudgetUsd: snapshot.settings.dailyUsd,
              monthlyBudgetUsd: snapshot.settings.monthlyUsd,
              perRunItemCap: snapshot.settings.perRunItemCap,
              perRunChargeCapUsd: snapshot.settings.perRunProviderChargeCapUsd,
              rawMediaRetentionDays: Number(retentionDays),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Control where new research can be ingested from. Disabling a
            provider blocks new ingestion from it; existing research stays
            available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProviderToggles initial={providers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage ledger</CardTitle>
          <CardDescription>
            Estimated costs come from the routing price table; reported costs
            are provider-billed values when available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No AI runs yet — the ledger fills in as you analyze videos.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Tokens (in/out)</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead className="text-right">Reported</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(run.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{run.operation}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.model ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.provider ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.input_tokens != null || run.output_tokens != null
                        ? `${run.input_tokens != null ? compact.format(run.input_tokens) : "—"} / ${run.output_tokens != null ? compact.format(run.output_tokens) : "—"}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.estimated_cost_usd != null
                        ? usd(Number(run.estimated_cost_usd), 4)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.reported_cost_usd != null
                        ? usd(Number(run.reported_cost_usd), 4)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.latency_ms != null
                        ? `${compact.format(run.latency_ms)} ms`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {run.status === "failed" ? (
                        <Badge
                          variant="destructive"
                          title={run.error ?? "Failed"}
                        >
                          Failed
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Succeeded</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent audit events</CardTitle>
          <CardDescription>
            The last 20 recorded changes and actions in this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No audit events yet.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {auditEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-sm font-medium">{event.action}</span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                  <span
                    className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
                    title={compactDetail(event.detail)}
                  >
                    {compactDetail(event.detail)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
