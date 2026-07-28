-- Performance: move per-request row scans into the database.
-- 1) latest_video_metrics — one pre-reduced row per video for the library view.
-- 2) workspace_spend(ws) — day/month spend + run count as a single aggregate.
-- Both run with the caller's privileges so RLS on the underlying tables applies.

create or replace view public.latest_video_metrics
with (security_invoker = true) as
select distinct on (video_id)
  video_id,
  workspace_id,
  views,
  likes,
  comments,
  shares,
  saves,
  captured_at
from public.video_metrics_snapshots
order by video_id, captured_at desc;

grant select on public.latest_video_metrics to authenticated;
grant select on public.latest_video_metrics to service_role;

create or replace function public.workspace_spend(ws uuid)
returns table (spent_today numeric, spent_month numeric, runs_month bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(
      sum(coalesce(reported_cost_usd, estimated_cost_usd, 0)) filter (
        where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      ),
      0
    ) as spent_today,
    coalesce(sum(coalesce(reported_cost_usd, estimated_cost_usd, 0)), 0) as spent_month,
    count(*) as runs_month
  from ai_runs
  where workspace_id = ws
    and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

grant execute on function public.workspace_spend(uuid) to authenticated;
grant execute on function public.workspace_spend(uuid) to service_role;

create index if not exists ai_runs_workspace_created_idx
  on public.ai_runs (workspace_id, created_at desc);

create index if not exists video_metrics_snapshots_video_captured_idx
  on public.video_metrics_snapshots (video_id, captured_at desc);
