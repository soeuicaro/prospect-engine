# Architecture

## Layers

```
UI (app/ pages, components/)
  → Server Actions (lib/actions/*)         — writes, mutations, orchestration
  → Queries (lib/queries/*)                — reads, shaped for a specific page
  → Domain (lib/domain/*)                  — pure functions, no I/O, unit-tested
  → Supabase clients (lib/supabase/*)      — the only place that talks to Postgres
```

`lib/domain/*` has zero dependency on Supabase, Next.js, or React — it is pure business logic (scoring, deduplication, CNPJ/phone normalization, message template rendering, Maps URL building) and is what `npm test` actually exercises. This is deliberate: the domain layer is the part of the spec ("never fabricate," "score is configurable," "dedup levels") that most needs to be provably correct and portable if the app is ever rehosted off Supabase/Vercel.

## Multi-tenancy

Every commercial table carries `workspace_id`. Row Level Security (see `DATABASE.md`) enforces isolation at the database layer — the application code does not (and must not) implement isolation itself as the only line of defense. `lib/workspace.ts` resolves the current user's workspace server-side; MVP is single-workspace-per-user, but `workspace_members` already supports multiple members/workspaces without a schema change.

## Provider abstractions (no vendor lock-in)

The product spec asks for the domain to survive a Supabase/Vercel departure. Concretely:

- `lib/supabase/client.ts` / `server.ts` / `admin.ts` are the **only** files that import `@supabase/*`. Nothing else in `lib/domain` or `lib/actions` business logic assumes Postgres syntax beyond standard SQL via the Supabase query builder.
- `lib/providers/osm.ts` isolates the OpenStreetMap integration behind plain functions (`geocodeCity`, `searchPlaces`) returning domain types (`OsmPlace`), not raw API responses — swapping providers means rewriting this one file.
- Outreach is provider-agnostic by construction: `lib/domain/phone.ts` builds `wa.me`/`mailto:` links, not calls to a paid messaging API. There is no `MessagingProvider` abstraction yet because there is no provider to abstract — assisted (manual) sending is the entire V1 channel strategy on purpose (see PROMPT MASTER §33-34, §101-103).
- `lib/domain/maps.ts` only ever builds a Google Maps **search URL** — it never fetches, stores, or replicates Maps content (see `MAPS_USAGE.md`).
- `lib/providers/website-analyzer.ts` fetches exactly one page (the homepage), respects `robots.txt` (`lib/providers/robots.ts`), never authenticates, and never stores raw HTML — only extracted flags/metadata/a content hash (`company_analysis`). Gap-fills `companies.phone/email/whatsapp` and `company_social_profiles` only when those fields are empty; never overwrites existing data.
- An `AIProvider` abstraction is intentionally **not implemented** — the product works entirely without AI (content ideas and message templates are rule/template-based). See Roadmap.

## Serverless constraints

Vercel Functions have a request timeout and no persistent memory between invocations. This shaped two concrete decisions:

- **CSV import runs synchronously within one request**, capped at 2,000 rows (`MAX_IMPORT_ROWS` in `lib/actions/imports.ts`). Larger datasets go through the local `tools/cnpj-importer` preprocessor first, which filters before anything reaches the app.
- **OSM discovery rate limiting is best-effort**, not a true cross-request limiter (no shared memory across invocations). Each discovery search is a single, human-triggered request, which keeps volume naturally low without needing Redis/Upstash. Documented explicitly in `lib/providers/osm.ts` rather than silently pretended-away.
- `automation_jobs` / `automation_logs` tables exist in the schema (with `checkpoint` columns for resumability) for future chunked background work, but no scheduler is wired up yet — see Roadmap.

## Scoring engine

`lib/domain/scoring.ts` computes the Prospect Score from:

1. **`scoring_rules`** (workspace-editable: key, category, points, weight, enabled) — the *value* of each signal.
2. **A fixed, named `RULE_EVALUATORS` map keyed by `scoring_rules.key`** — the *code* that decides whether a signal is present. Editing this requires a code change; editing how much it counts does not (Settings → Score).
3. **`scoring_category_weights`** — how the 7 category sub-scores (digital_presence, content_need, purchase_capacity, marketing_opportunity, fit, size, local_proximity) combine into the final 0–100 Prospect Score.

An evaluator only ever returns `fires: true` on positive evidence. Absence of evidence is `fires: false`, never treated as a negative fact — see PROMPT MASTER §68, §214.

## Roadmap (explicitly not built in V1)

Kept out of V1 on purpose (see PROMPT MASTER §179 MVP definition, §205-207) rather than half-built:

- Chunked/resumable background jobs + cron digests (`automation_jobs` schema exists, worker does not)
- XLSX import (CSV works today; `xlsx`/SheetJS pulled from npm has an unpatched high-severity advisory — see `SECURITY.md`)
- Full workspace export/backup (ZIP), workspace restore
- Command palette (Ctrl+K), keyboard shortcuts, dark mode toggle
- Multi-seat role enforcement beyond the `workspace_members.role` column (RLS currently checks membership, not role, for most tables)
- `AIProvider` implementations beyond `DisabledAIProvider` behavior (none exist — the product intentionally functions without AI)
