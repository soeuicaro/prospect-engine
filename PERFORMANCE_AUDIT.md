# Performance Audit — Prospect Engine

Date: 2026-09-21
Stack: Next.js 16.3.5 (App Router, Turbopack), React 19.2.8, Supabase/Postgres, deployed on Vercel.
Method: static audit (read every query/action file touching the hot paths below), request-count
counting as the primary before/after metric (this environment has no live Supabase project to
run `EXPLAIN ANALYZE` or wall-clock timings against — see "Methodology" at the bottom).

## Executive summary — top bottlenecks found, ranked

| # | Severity | Area | Problem |
|---|----------|------|---------|
| 1 | **CRITICAL** | DATABASE / ARCHITECTURE | `runImportAction` (CSV import) ran ~10-12 sequential DB round trips **per row**, in a loop, inside one request. A 2000-row import issued **~20,000+ sequential queries**. |
| 2 | **CRITICAL** | DATABASE / ARCHITECTURE | `importOsmPlacesAction` (Discovery → "import selected places") had the identical per-row pattern: dedup check + insert + source insert + full score recompute, sequentially, for up to 60 places → **~780 sequential queries** per click. |
| 3 | **HIGH** | DATABASE / CORRECTNESS | `listCompanies` "sort by score" (`/companies?sort=score`) only sorted the 25 rows already fetched for the current page — every other page silently stayed in `created_at` order. Not just slow, actually wrong. |
| 4 | **MEDIUM** | DATABASE / NETWORK | Dashboard fetched `pipeline_stages` **twice** in the same request and used a 3rd sequential round trip (after 2 parallel waves) just to get one count that could be computed from data already in hand. |
| 5 | MEDIUM | FRONTEND | `recharts` (a large charting library) is a dependency but is imported nowhere — dead weight in `node_modules`/install size, though not currently shipped to the client. |
| 6 | LOW | RENDERING | `company-detail` query fetches 17 tables in parallel with several `select("*")` — not a waterfall (good), but overfetches columns on a few high-cardinality tables (`notes`, `lead_outreach`, `lead_stage_history`). Flagged, not changed (see Risks). |
| 7 | — | Everything else checked | No N+1 loops in `bulk.ts` (already bulk insert/update), no polling/`setInterval`/Realtime subscriptions anywhere, no middleware, no SELECT * in list views, indexes already cover the filters actually used (`workspace_id`, trigram indexes on name columns, `company_scores(workspace_id, prospect_score desc)`), RLS uses a `SECURITY DEFINER` helper (`is_workspace_member`) so it isn't running a correlated subquery per row, companies list/pipeline board are server-paginated/capped (25 / 500 rows) — no client-side virtualization needed at current scale. |

Items 1 and 2 dominate everything else combined — they're the only findings in this codebase capable of causing a Vercel function timeout or making a routine action take tens of seconds instead of under one.

## What was changed

### 1. `src/lib/actions/imports.ts` — CSV import (CRITICAL)
**Before:** for each row — `INSERT companies` → `INSERT company_sources` → `recomputeCompanyScore()` (itself ~5 parallel reads + up to 2 more + 1 count + 3 writes ≈ 8-10 round trips). All sequential, inside a `for` loop, for up to `MAX_IMPORT_ROWS` (2000) rows.

**After:** split into two passes.
- **Pass 1** (pure, no DB calls): validate, normalize, dedup (unchanged in-memory logic against `existing[]`), and score every row **in memory**, calling the existing pure `computeProspectScore()` / `computeDataQualityScore()` functions directly instead of going through the DB-backed `recomputeCompanyScore()` wrapper. This is valid because a freshly-imported row can never have an `industry_id` (not an importable CSV field), contacts, social profiles, or website analysis yet — every signal that previously required a read is statically known to be empty/null for this path.
- Scoring rules and category weights (identical for every row in one workspace) are read **once**, not once per row.
- **Pass 2**: batched writes — `companies`, `company_sources`, `company_scores`, `company_score_factors`, `import_errors` are each inserted in chunks of 500 via `Promise.all`, instead of one `INSERT` per row. IDs are generated client-side (`crypto.randomUUID()`) so dependent rows can be built without a round trip back for the generated ID. A chunk's dependent rows are only queued once that chunk's `companies` insert has confirmed success, so a failed batch can't leave orphaned `company_scores`/`company_sources` rows.
- The 4 initial reads (create import job, find "NEW" stage, existing companies for dedup, scoring rules/weights) are now fetched with one `Promise.all` instead of sequential awaits.

**Round-trip count, 2000-row import:** ~20,000+ sequential → **6 initial reads (parallel) + ~4 chunks × ~4 writes ≈ 25-30 total, mostly parallel.**

### 2. `src/lib/actions/discovery.ts` — OSM Discovery import (CRITICAL)
Same anti-pattern, same fix shape. Dedup check changed from one `maybeSingle()` query per place to a single `.in("source_record_id", osmIds)` query for all places at once. Industry/playbook lookup (needed here, unlike CSV import, since Discovery lets the user pick an `industryId`) is fetched **once** for the whole batch instead of per place. Score computation moved to the same pure in-memory pattern as imports.ts.

**Round-trip count, 60-place discovery import:** ~780 sequential → **6 parallel reads + 1-4 batched writes.**

### 3. `src/lib/queries/companies.ts` — sort-by-score correctness/perf bug (HIGH)
`filters.sortBy === "score"` now orders in Postgres via the joined `company_scores` table (`query.order("prospect_score", { referencedTable: "company_scores", ... })`), the same pattern the dashboard query already used correctly. Removed the dead post-fetch `rows.sort(...)` that only ever reordered the 25 rows already on the page.

### 4. `src/lib/queries/dashboard.ts` — duplicate query + extra waterfall stage (MEDIUM)
`qualifiedStageIds` is now derived from the `pipeline_stages` result already fetched in wave 1 (`stageList.filter(s => s.key !== "NEW")`) instead of re-querying `pipeline_stages` a second time. The "qualified companies" count moved into the same `Promise.all` as meetings/proposals/won, eliminating the 3rd sequential round trip that used to follow it.

**Dashboard round trips:** 9 (wave 1) → **9 (wave 1, unchanged) + 4 (wave 2)**, down from 9 + 4 + 1, and from **3 sequential waterfall stages to 2** — a ~33% reduction in the request's critical-path latency (dashboard latency is bounded by `max(wave1) + max(wave2)`, not the sum of all 13 queries, since each wave runs in parallel).

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint` on all 4 changed files — clean.
- `npx vitest run` — 36/36 tests pass (domain-layer scoring/dedup/cnpj/phone tests, unaffected — the changed action files call the same pure functions those tests already cover).
- `npm run build` (production, Turbopack) — compiles successfully, all routes still render.
- Feature parity: dedup logic, validation rules, error reporting (per-row `import_errors`), audit logging, and revalidation paths are unchanged — only *how many round trips* it takes to get there changed.

## Methodology note (why no literal "before: 1.8s / after: 420ms" numbers)

This environment has no live Supabase project or seeded dataset to run against, so wall-clock
timings would be fabricated. The `PROMPT MASTER` brief for this task explicitly says: *"Quando
métricas exatas não forem disponíveis, medir por aproximações confiáveis e explicar a
metodologia"* — the approximation used here is **DB round-trip counting**, which is the
dominant cost for these two actions specifically because Supabase queries from a Vercel
function each pay a full network round trip (tens of ms minimum, more under connection-pool
contention); sequential round trips are additive, parallel ones are not. Cutting a 2000-row
import from ~20,000 sequential round trips to ~30 mostly-parallel ones is not a marginal
optimization regardless of the per-query latency constant — it is the difference between an
action that cannot possibly finish inside Vercel's function timeout at realistic import sizes,
and one that reliably will.

## Database

No index changes were needed — the existing migration (`0003_companies.sql`) already has the
indexes the hot-path queries use: `companies(workspace_id) where deleted_at is null`,
`companies(workspace_id, state, city)`, `companies(workspace_id, cnpj)`, GIN trigram indexes on
`trade_name`/`legal_name` (used by the `/companies` search `ilike`), `companies(workspace_id,
pipeline_stage_id)`, `companies(workspace_id, industry_id)`, GIN on `tags`, and
`company_scores(workspace_id, prospect_score desc)` (used by both the dashboard's top-leads
query and the now-fixed score sort). RLS policies use a `SECURITY DEFINER` helper
(`is_workspace_member`) specifically so policy checks don't recurse into RLS on
`workspace_members` — this was already done correctly and needed no change.

## Frontend / rendering

Reviewed for Server vs. Client Component usage, hydration cost, bundle size, waterfalls, and
re-renders. No changes were needed here:
- All list/detail pages are Server Components; only interactive leaves (`CompaniesTable`,
  `PipelineBoard`, `Topbar`) are Client Components, and each is scoped to what's actually
  interactive (selection, drag state, dropdown).
- No client-side data fetching, no `useEffect`-driven fetches, no search-as-you-type (the
  companies filter form is a plain GET form — full navigation, server-rendered results, so no
  debounce is needed because there's nothing firing per keystroke).
- No polling, no `setInterval`, no Supabase Realtime subscriptions anywhere in the app.
- Tables are server-paginated (25 rows) or capped (pipeline board: 500), so no virtualization is
  needed at current scale.
- `recharts` is an unused dependency — safe to remove from `package.json`, though since nothing
  imports it, it isn't currently inflating the shipped client bundle.

## Cache

No `cacheComponents` / `"use cache"` (Next 16's Cache Components model) is enabled in
`next.config.ts`, and no route uses `revalidate`/ISR — every authenticated page is fully
dynamic (SSR per request), which is correct by default for workspace-scoped, per-tenant CRM
data (§75/§77 of the brief: never share cache across workspaces). Reference data that changes
rarely (`industries`, `pipeline_stages`, `offers`, `message_templates`) is small
(tens of rows, already indexed by `workspace_id`) and was not wrapped in `unstable_cache` —
the query cost there is already low, and adding cache-tag invalidation correctness risk across
every mutation site (`catalog.ts`, `settings.ts`) for a query that's already fast was judged
not worth it under this task's own rule 189 ("if the answer is 'maybe faster', don't").

## Vercel / Supabase platform

No middleware exists in the app (checked — none of the config warrants adding one). No API
routes proxy to Supabase unnecessarily — Server Components and Server Actions talk to Supabase
directly, which is correct for this stack. No service-role key usage was found outside
server-only contexts.

## Risks / what's still worth watching

- **`company-detail.ts`** fetches 17 tables in parallel per lead-detail page load. It's
  parallel (not a waterfall), so wall-clock impact is bounded by the slowest single query, but
  several use `select("*")` on tables that can grow (notes with a joined profile, full outreach
  history, full stage history). Not changed in this pass — trimming columns safely requires
  cross-referencing every field each of several detail-page components actually renders, and
  getting that wrong risks a silent UI regression for low measured gain (17 small indexed
  queries in parallel are already fast). Worth a dedicated pass if lead-detail is later found to
  be slow in practice.
- **Dashboard** still issues 13 individual count/select queries (in 2 parallel waves) rather
  than one aggregate RPC. A Postgres function returning all dashboard counts in one query is the
  natural next step if dashboard latency is ever profiled as DB-round-trip-bound rather than
  render-bound — not done here because it requires a new migration + RPC and the current
  2-wave version already gives most of the achievable win without that added surface area.
- **Import/Discovery batch size**: chunked at 500 rows per write. If Supabase/Postgres response
  size or statement time ever becomes a problem at higher `MAX_IMPORT_ROWS`, lower
  `INSERT_BATCH_SIZE` in `imports.ts` / `discovery.ts` — it's a single constant in each file.
- Neither import path currently limits *concurrency* across chunks beyond what `Promise.all`
  naturally does (4 tables × a few chunks) — at today's row caps (2000 CSV / 60 OSM) this is
  fine; if those caps are raised significantly, revisit.

## Next steps (only if a future pass finds these still matter in practice)

1. Dashboard summary RPC (see Risks above) if the dashboard is ever profiled as DB-bound.
2. Column-trim `company-detail.ts`'s `select("*")` calls after auditing what each detail-page
   component actually renders.
3. Remove the unused `recharts` dependency.
4. If lead volumes grow far past current scale, revisit `CompaniesTable`/`PipelineBoard` for
   row virtualization — not needed at today's 25/500-row caps.
