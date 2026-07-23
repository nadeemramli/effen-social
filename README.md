# EFFEN Social Content Studio

Private social-video research and script-generation studio. Collect short-form videos
(YouTube link, optional Instagram/TikTok, or direct upload), analyze the ones you choose,
triage AI idea candidates, and develop them through a Topic → Research → Hook → Script
workflow into an exportable, versioned script — with hard cost controls at every step.

## Repository layout

```
apps/web        Next.js 16 App Router UI + API routes + server actions
apps/worker     Containerizable media worker (FFmpeg + Node) — polls the durable job queue
packages/core   Shared domain: pipeline state machine, metrics/outlier rules, provider
                interfaces, AI routing + cost tables, zod schemas, mock AI generators
supabase/       SQL migrations (schema, RLS, grants, job-claim function) + local config
docs/           DECISIONS.md — assumptions and deviations log
```

## Quick start (development, mock mode — zero external spend)

Prereqs: Node 22+, pnpm, Docker, Supabase CLI, FFmpeg.

```bash
pnpm install
supabase start                  # local Postgres+Auth on ports 55321/55322 (see supabase/config.toml)
# .env.development.local points the app at the local stack (already set up)
pnpm dev                        # web on http://localhost:3000
pnpm dev:worker                 # media worker (separate terminal)
```

Sign up with any email/password (local auth auto-confirms). A workspace, its settings,
and budget defaults are bootstrapped automatically.

**Mock mode** (`EFFEN_MODE=mock`, the default) uses deterministic development adapters
for all AI and ingestion providers: the full pipeline runs — FFmpeg normalization is
real — but no external provider is called and nothing is spent. The shell shows a
"Mock mode" badge whenever it is active.

## Hosted Supabase

The hosted project `effen-social` (ref `ahtzzntqarlujqesyetm`) already has all
migrations applied. `.env.local` points at it. To run against it:

1. Delete (or rename) `.env.development.local`.
2. Paste the project's **service role key** into `SUPABASE_SECRET_KEY` in `.env.local`
   (Dashboard → Project Settings → API keys). The worker cannot run without it.

## Going live (per integration, all optional)

| Capability       | Env vars                                 | Notes                                                                                                                 |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **All AI**       | `OPENROUTER_API_KEY` + `EFFEN_MODE=live` | One key for every model via OpenRouter; live wizard, analysis, and audio transcription; billed cost captured per call |
| YouTube metadata | `YOUTUBE_API_KEY`                        | Official Data API v3; embed playback; no downloading                                                                  |
| Instagram/TikTok | `APIFY_TOKEN` (+ enable in Settings)     | Unofficial, off by default; upload/link fallback works                                                                |
| Media storage    | `EFFEN_STORAGE=r2` + `R2_*`              | S3-compatible signed URLs; local disk otherwise                                                                       |
| Job queue        | `EFFEN_QUEUE=qstash` + `QSTASH_*`        | Postgres-backed polling queue otherwise                                                                               |

Model slugs live in **one file**: `packages/core/src/ai/routing.ts` (OpenRouter
"vendor/model" format), each overridable via env (`EFFEN_MODEL_*`). Transcription uses
an audio-capable chat model (Gemini Flash) since OpenRouter has no dedicated STT
endpoint. Verify slugs on openrouter.ai/models before enabling live mode.

## Commands

```bash
pnpm -r typecheck        # strict TS across core, web, worker
pnpm -r test             # unit tests (state machine, metrics, budget, URLs, schemas)
pnpm --filter web lint
pnpm format
pnpm --filter web exec playwright test          # full E2E (needs local stack + web + worker running)
docker build -f apps/worker/Dockerfile .        # containerized worker
```

## Cost controls (P0)

Metadata collection is separated from paid deep analysis. Every cost-incurring dispatch
is checked against the workspace's daily/monthly budgets and per-run item/charge caps
_before_ queueing; blocked runs surface as a visible `budget_blocked` state, never a
silent drop. All AI operations are recorded in the `ai_runs` ledger (estimated + reported
cost, tokens, latency, prompt/schema/persona versions). Analyses are cached by media
checksum + prompt version so identical content is never re-billed. Raw media originals
are cleaned up after a configurable retention window.

## Security

Row-level security on every workspace table (verified by tests), explicit grants,
server-side ownership checks on every action, short-lived HMAC/presigned object URLs,
SSRF-safe media fetching, strict upload validation, secrets never in client bundles,
and an audit log for destructive/settings actions.
