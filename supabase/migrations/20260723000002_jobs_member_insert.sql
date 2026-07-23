-- Members may enqueue jobs for their own workspace (dispatch from the web tier
-- with the user's session). Locking/processing/status updates remain
-- service-role only, so a member cannot run or tamper with the queue itself.
create policy jobs_insert on public.jobs
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
grant insert on public.jobs to authenticated;

-- Members may write their own workspace audit entries and AI-run ledger rows
-- from server actions (still constrained to their own workspace by RLS).
create policy audit_insert on public.audit_log
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
grant insert on public.audit_log to authenticated;

create policy ai_runs_insert on public.ai_runs
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
grant insert on public.ai_runs to authenticated;
