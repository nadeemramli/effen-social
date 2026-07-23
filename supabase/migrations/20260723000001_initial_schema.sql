-- EFFEN Social Content Studio — initial schema
-- All user-owned tables carry workspace_id, enforce RLS via workspace membership,
-- and use explicit grants. Worker/service processes use the service role (bypasses RLS)
-- but the web tier always re-checks ownership server-side as well.

-- ============================================================ enums

create type public.platform as enum ('youtube', 'instagram', 'tiktok', 'upload');

create type public.pipeline_status as enum (
  'created', 'discovering', 'metadata_ready', 'selected_for_analysis',
  'acquiring_media', 'normalizing', 'transcribing', 'analyzing',
  'generating_ideas', 'complete', 'cancelled', 'failed_retryable',
  'failed_permanent', 'media_unavailable', 'budget_blocked', 'policy_blocked'
);

create type public.video_origin as enum ('url', 'discovery', 'upload');

create type public.asset_kind as enum ('original', 'proxy', 'audio', 'poster', 'frame', 'export');

create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed', 'dead');

create type public.idea_status as enum ('inbox', 'shortlisted', 'discarded', 'archived');

create type public.script_status as enum ('draft', 'revising', 'ready', 'recorded', 'archived');

create type public.script_stage as enum ('topic', 'research', 'hook', 'script');

create type public.ai_run_status as enum ('succeeded', 'failed');

-- ============================================================ core tables

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  daily_budget_usd numeric(10, 2) not null default 5.00,
  monthly_budget_usd numeric(10, 2) not null default 50.00,
  per_run_item_cap integer not null default 25 check (per_run_item_cap > 0),
  per_run_charge_cap_usd numeric(10, 2) not null default 2.00,
  raw_media_retention_days integer not null default 30 check (raw_media_retention_days >= 0),
  providers_enabled jsonb not null default '{"manual_upload": true, "youtube_official": true, "instagram_apify": false, "tiktok_apify": false}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  current_version integer not null default 1,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personas_workspace_idx on public.personas (workspace_id);

create table public.persona_versions (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null,
  content jsonb not null, -- { audience, voice, pillars[], goals, boundaries, sampleTopics[] }
  created_at timestamptz not null default now(),
  unique (persona_id, version)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform public.platform not null,
  external_id text not null,
  handle text not null,
  display_name text,
  avatar_url text,
  follower_count bigint,
  profile_url text not null,
  tags text[] not null default '{}',
  enabled boolean not null default true,
  last_discovered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);
create index sources_workspace_idx on public.sources (workspace_id);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid references public.sources (id) on delete set null,
  platform public.platform not null,
  origin public.video_origin not null,
  external_id text,
  canonical_url text,
  title text,
  caption text,
  published_at timestamptz,
  duration_seconds numeric(10, 3),
  thumbnail_url text,
  hashtags text[] not null default '{}',
  language text,
  status public.pipeline_status not null default 'created',
  status_detail text,
  last_error text,
  media_checksum text, -- sha256 of normalized original; analysis cache key
  playback_embed_url text,
  upload_file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index videos_dedupe_external_idx
  on public.videos (workspace_id, platform, external_id) where external_id is not null;
create unique index videos_dedupe_checksum_idx
  on public.videos (workspace_id, media_checksum) where media_checksum is not null;
create index videos_library_idx on public.videos (workspace_id, status, published_at desc);
create index videos_source_idx on public.videos (source_id);

create table public.video_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  captured_at timestamptz not null default now()
);
create index metrics_video_idx on public.video_metrics_snapshots (video_id, captured_at desc);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind public.asset_kind not null,
  storage_key text not null unique,
  content_type text not null,
  bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric(10, 3),
  frame_time_seconds numeric(10, 3), -- for scene frames
  created_at timestamptz not null default now()
);
create index media_assets_video_idx on public.media_assets (video_id);

create table public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  from_status public.pipeline_status,
  to_status public.pipeline_status not null,
  detail text,
  created_at timestamptz not null default now()
);
create index pipeline_events_video_idx on public.pipeline_events (video_id, created_at desc);

-- ============================================================ jobs

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status public.job_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 4,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one active job per idempotency key
create unique index jobs_active_idempotency_idx
  on public.jobs (idempotency_key) where status in ('pending', 'running');
create index jobs_poll_idx on public.jobs (status, run_after);

-- ============================================================ analysis & ideas

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null,
  schema_version integer not null,
  prompt_version text not null,
  persona_id uuid references public.personas (id) on delete set null,
  persona_version integer,
  media_checksum text,
  content jsonb not null, -- AnalysisV1; AI output only, never user-edited
  model text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  unique (video_id, version)
);
create index analyses_video_idx on public.analyses (video_id, version desc);
create index analyses_cache_idx on public.analyses (workspace_id, media_checksum, prompt_version);

create table public.analysis_notes (
  video_id uuid primary key references public.videos (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  video_id uuid references public.videos (id) on delete set null,
  analysis_id uuid references public.analyses (id) on delete set null,
  title text not null,
  angle text not null,
  status public.idea_status not null default 'inbox',
  storytelling_format text,
  persona_relevance text,
  originality_rationale text,
  evidence jsonb not null default '[]'::jsonb,
  copying_risk text check (copying_risk in ('low', 'medium', 'high')),
  copying_risk_note text,
  notes text not null default '', -- user-authored, never AI-overwritten
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_workspace_status_idx on public.ideas (workspace_id, status, created_at desc);

create table public.hooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mechanism text not null, -- abstract reusable mechanism, not source wording
  category text not null,
  example text, -- user- or AI-authored ORIGINAL example, never a source quote
  notes text not null default '',
  source_analysis_id uuid references public.analyses (id) on delete set null,
  created_at timestamptz not null default now()
);
create index hooks_workspace_idx on public.hooks (workspace_id, created_at desc);

-- ============================================================ scripts

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  idea_id uuid references public.ideas (id) on delete set null,
  title text not null default 'Untitled script',
  status public.script_status not null default 'draft',
  stage public.script_stage not null default 'topic',
  topic jsonb, -- user-entered topic/angle/audience
  research jsonb, -- ResearchV1 (AI) — user notes live inside topic/user fields
  hook jsonb, -- chosen hook + generated options
  current_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scripts_workspace_idx on public.scripts (workspace_id, updated_at desc);

create table public.script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.scripts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null,
  content jsonb not null, -- ScriptV1
  created_by text not null check (created_by in ('ai', 'user')),
  label text,
  created_at timestamptz not null default now(),
  unique (script_id, version)
);

-- ============================================================ ledger, diagnostics, audit

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  operation text not null,
  provider text not null,
  model text not null,
  prompt_template text not null,
  prompt_version text not null,
  input_schema_version integer,
  output_schema_version integer,
  persona_version integer,
  source_analysis_version integer,
  input_tokens bigint,
  output_tokens bigint,
  media_seconds numeric(10, 3),
  estimated_cost_usd numeric(12, 6) not null default 0,
  reported_cost_usd numeric(12, 6),
  latency_ms integer,
  status public.ai_run_status not null,
  error text,
  safety_flags text[] not null default '{}',
  video_id uuid references public.videos (id) on delete set null,
  script_id uuid references public.scripts (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_runs_ledger_idx on public.ai_runs (workspace_id, created_at desc);

create table public.raw_provider_payloads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  ref_type text not null, -- 'video' | 'source' | 'run'
  ref_id uuid,
  payload jsonb not null, -- sanitized: no credentials/secrets
  created_at timestamptz not null default now()
);
create index raw_payloads_ref_idx on public.raw_provider_payloads (ref_type, ref_id);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid,
  action text not null, -- e.g. 'video.delete', 'settings.budget_update', 'provider.toggle'
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_workspace_idx on public.audit_log (workspace_id, created_at desc);

-- ============================================================ helpers & triggers

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger videos_touch before update on public.videos
  for each row execute function public.touch_updated_at();
create trigger ideas_touch before update on public.ideas
  for each row execute function public.touch_updated_at();
create trigger scripts_touch before update on public.scripts
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();
create trigger personas_touch before update on public.personas
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.workspace_settings
  for each row execute function public.touch_updated_at();

-- Bootstrap: every new auth user gets a workspace, membership, and settings row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || '''s studio')
  returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws_id, new.id, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws_id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ RLS

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.personas enable row level security;
alter table public.persona_versions enable row level security;
alter table public.sources enable row level security;
alter table public.videos enable row level security;
alter table public.video_metrics_snapshots enable row level security;
alter table public.media_assets enable row level security;
alter table public.pipeline_events enable row level security;
alter table public.jobs enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_notes enable row level security;
alter table public.ideas enable row level security;
alter table public.hooks enable row level security;
alter table public.scripts enable row level security;
alter table public.script_versions enable row level security;
alter table public.ai_runs enable row level security;
alter table public.raw_provider_payloads enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_log enable row level security;

-- workspaces: members can see; nobody creates directly (bootstrap trigger only)
create policy workspaces_select on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces
  for update to authenticated using (public.is_workspace_member(id))
  with check (public.is_workspace_member(id));

create policy members_select on public.workspace_members
  for select to authenticated using (user_id = (select auth.uid()) or public.is_workspace_member(workspace_id));

create policy settings_select on public.workspace_settings
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy settings_update on public.workspace_settings
  for update to authenticated using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- generic member CRUD for content tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'personas', 'persona_versions', 'sources', 'videos', 'video_metrics_snapshots',
    'media_assets', 'pipeline_events', 'analyses', 'analysis_notes', 'ideas', 'hooks',
    'scripts', 'script_versions'
  ]
  loop
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_workspace_member(workspace_id));',
      t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.is_workspace_member(workspace_id));',
      t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));',
      t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.is_workspace_member(workspace_id));',
      t, t);
  end loop;
end $$;

-- read-only for members; writes are service-role only
create policy jobs_select on public.jobs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy ai_runs_select on public.ai_runs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy raw_payloads_select on public.raw_provider_payloads
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy audit_select on public.audit_log
  for select to authenticated using (public.is_workspace_member(workspace_id));
-- webhook_events: service-role only — no authenticated policies at all.

-- ============================================================ grants

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;
grant select, update on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, update on public.workspace_settings to authenticated;
grant select, insert, update, delete on
  public.personas, public.persona_versions, public.sources, public.videos,
  public.video_metrics_snapshots, public.media_assets, public.pipeline_events,
  public.analyses, public.analysis_notes, public.ideas, public.hooks,
  public.scripts, public.script_versions
to authenticated;
grant select on public.jobs, public.ai_runs, public.raw_provider_payloads, public.audit_log to authenticated;
