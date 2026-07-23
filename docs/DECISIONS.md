# Decisions & documented assumptions

A running log of choices made where the PRD was silent, ambiguous, or unavailable.

## 0. The PRD file itself

The referenced `EFFEN Social Content Studio - PRD.md` was not present in the repository
or attached files. The detailed build brief (functional requirements, screens, pipeline
states, security and cost requirements) served as the operative spec. Anything the brief
delegated to the PRD is defined below as an explicit assumption.

## 1. Scoring rules (assumed — PRD formulas unavailable)

- **Outlier score** = video views ÷ trailing median views of the same source's most
  recent 20 videos (excluding the video itself). Requires ≥ 5 peer videos with known
  view counts; otherwise the UI shows **"Insufficient history"** and never a number.
  Buckets: <0.5 under, <2 normal, <5 over, ≥5 breakout. (`packages/core/src/domain/metrics.ts`)
- **Engagement rate** = (likes + comments + shares + saves — only fields the platform
  actually reports) ÷ views; `null` when views are missing. Never fabricated.

## 2. Architecture

- **pnpm workspace**: `apps/web` (Next.js 16), `apps/worker` (Node + FFmpeg,
  Dockerfile provided), `packages/core` (shared domain, consumed as TS source via
  `transpilePackages`).
- **Hosted Supabase** project `effen-social` (ref `ahtzzntqarlujqesyetm`,
  ap-southeast-1, $10/month — user-approved) carries the same migrations as the local
  CLI stack. Local stack runs on shifted ports (55321/55322) because another project's
  stack occupied the defaults.
- **Job queue**: durable `jobs` table + `claim_job()` SQL function
  (`FOR UPDATE SKIP LOCKED`, visibility-timeout reaping). Members may **insert** jobs
  for their own workspace (RLS-checked) so the web tier can enqueue without the service
  key; claiming/processing is service-role only. QStash dispatcher exists behind the
  same `JobDispatcher` interface for production push delivery.
- **Storage**: `StorageAdapter` interface with a local-disk adapter (HMAC-signed,
  expiring URLs served by `/api/local-storage`, mirroring presigned-URL semantics) and
  an R2 adapter using dependency-free SigV4 presigning. The worker currently writes
  directly to the local storage directory; R2 support in the worker is a known gap
  (listed in README risks) until live media acquisition lands.
- **Pipeline semantics**: uploads sit at `metadata_ready` after upload; ALL media work
  (validation, proxy, audio, frames, checksum) runs *after* the user selects the video
  for analysis, keeping expensive processing strictly opt-in per the cost principles.
  Each step is a separate idempotent job; steps forward `params` (e.g. `force`) down
  the chain.
- **Regeneration** bypasses the checksum cache deliberately (`params.force`) and varies
  the mock seed by version so a new version is genuinely different; it never overwrites
  prior versions or user notes.

## 3. Budgets in mock mode

Pre-run estimates always use live-mode pricing from the routing table, even in mock
mode, so budget caps and the `budget_blocked` path stay exercisable end-to-end. The
`ai_runs` ledger records **$0** estimated cost for mock runs (honest spend), so the
"spent today/month" figures only move with real providers.

## 4. Mock adapters

- Deterministic by seed (content checksum / entity id) — same input, same output —
  which makes duplicate detection, caching, and E2E tests reproducible.
- `EFFEN_MOCK_OUTAGE="tiktok,instagram"` makes those mock providers throw
  `provider_down` for failure-path testing.
- All mock outputs validate against the same zod schemas the live adapters must satisfy.

## 5. Live-AI gap (Milestone 3/4 work)

Live adapters implemented and validated: YouTube Data API v3 (metadata/discovery/
metrics), Apify Instagram + TikTok (metadata/discovery/metrics/run-status/cost). The
worker's live path for transcription (OpenAI) and video understanding (Gemini) is
stubbed with explicit errors naming the required env vars — in live mode without those
adapters the video fails **retryably** with a clear message rather than pretending.
Model IDs in `routing.ts` must be re-verified against provider docs before live use.

## 6. Security posture

- RLS on all workspace tables; `is_workspace_member()` SECURITY DEFINER helper;
  explicit grants; anon role fully revoked (verified: `permission denied`).
- Web tier re-checks ownership in every server action (defense in depth over RLS).
- `webhook_events` has no authenticated policies at all (service-role only).
- Local signed URLs: HMAC-SHA256 over `key|op|exp` with constant-time compare; storage
  keys validated against traversal.
- Worker SSRF guard: https-only, per-hop DNS resolution with private/link-local/CGNAT
  range rejection, bounded redirects and size.
- Sanitized provider payloads: credential-looking keys stripped before persisting
  `raw_provider_payloads`.

## 7. Misc product decisions

- Adding a single video URL auto-upserts its creator as a `sources` row so outlier
  scoring has a peer group to grow into.
- Deleting a source keeps its videos (`ON DELETE SET NULL`).
- "Save hook to library" stores the analysis's abstract mechanism + category only —
  never the source quote (which is displayed as labeled evidence, marked do-not-reuse).
- Script autosaves collapse into a single `autosave` user version until an AI operation
  creates a new version; restores append rather than rewrite history.
- Duplicate prevention: unique `(workspace, platform, external_id)` for links and
  unique `(workspace, media_checksum)` for uploads — a byte-identical re-upload fails
  permanently with a pointer to the existing video.
