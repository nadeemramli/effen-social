-- Atomic job claim for the polling worker (service role only).
-- Uses SKIP LOCKED so multiple workers never double-claim, and a visibility
-- timeout so crashed workers release their jobs.

create or replace function public.claim_job(worker_id text, visibility_timeout_seconds integer default 600)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reap jobs whose worker died: running past the visibility timeout.
  update public.jobs
    set status = 'pending', locked_at = null, locked_by = null
    where status = 'running'
      and locked_at < now() - make_interval(secs => visibility_timeout_seconds);

  return query
  update public.jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        locked_at = now(),
        locked_by = worker_id
    where j.id = (
      select id from public.jobs
      where status = 'pending' and run_after <= now()
      order by created_at
      for update skip locked
      limit 1
    )
    returning j.*;
end;
$$;

-- Only the service role may claim jobs.
revoke execute on function public.claim_job(text, integer) from public, anon, authenticated;
