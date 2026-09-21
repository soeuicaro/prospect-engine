# Testing

## What's tested today

Unit tests (Vitest) on the pure domain layer — `src/lib/domain/*.test.ts`:

- **`scoring.test.ts`** — Prospect Score never fires an unknown rule key, disabled rules are ignored, category weighting math, "no rule fired → score 0" (never invents evidence)
- **`dedup.test.ts`** — EXACT match (CNPJ or domain), LIKELY match (2+ weak signals), POSSIBLE_DUPLICATE (1 weak signal, never auto-merged), NO_MATCH
- **`cnpj.test.ts`** — check-digit validation (including rejecting repeated-digit sequences like `11.111.111/1111-11`), normalization, formatting, root extraction
- **`phone.test.ts`** — Brazilian phone normalization, `wa.me` link building, email format validation
- **`templates.test.ts`** — variable substitution never fabricates a missing value (renders `[var?]` instead), personalization level is only claimed when the underlying evidence actually exists

Run:

```bash
npm test          # vitest run
npm run build     # also runs the TypeScript compiler across the whole app
npm run lint      # ESLint, including React purity rules
```

All three currently pass clean (33 tests, 0 lint errors, 0 `npm audit` vulnerabilities) as of this writing.

## What's NOT tested yet (and why)

- **RLS policies against a live Postgres instance** — no Supabase project is connected in this development environment. `SECURITY.md`'s checklist marks this explicitly unverified. Before production use: sign up two separate accounts on a real deployment and manually confirm workspace isolation (steps in `DEPLOYMENT.md` §5), or write a Supabase-CLI-based integration test suite that spins up a local Postgres via `supabase start`.
- **Server Actions / Route Handlers** — these require a live database; not covered by the current Vitest config (`environment: "node"`, no DB). Adding integration tests here is the natural next step once a Supabase project is linked.
- **UI/component tests** — none yet. Manual verification was done by running `npm run build` after every module (companies, campaigns, pipeline, imports, discovery, settings) and inspecting the route list; no headless browser was available in this environment to click through the UI live.

## Critical test cases from the product spec — status

| Case | Status |
|---|---|
| User A cannot see workspace B's data | RLS policy exists (`0007_rls.sql`); not yet exercised by an automated test — see above |
| Suppressed lead never enters a campaign | `buildCampaignAudienceAction` filters `suppression_list` before queuing (`lib/actions/campaigns.ts`) — not yet unit tested in isolation |
| Duplicate import doesn't create two records | Covered indirectly by `dedup.test.ts` (the matching logic itself); the full `runImportAction` flow is not yet integration-tested |
| Template with a missing variable doesn't crash | Covered by `templates.test.ts` |
| Campaign with no contactable leads doesn't silently "succeed" | `buildCampaignAudienceAction` returns an explicit error when zero candidates match (`lib/actions/campaigns.ts`) |
| Score with no data doesn't produce a false positive | Covered by `scoring.test.ts` ("scores 0 when no rule fires") |
| Import job interrupted can continue | `tools/cnpj-importer` supports `--checkpoint`; the in-app CSV importer (`runImportAction`) does not yet (single-request, capped at 2,000 rows specifically to avoid needing this — see `ARCHITECTURE.md`) |
| Client cannot use the service-role key | Enforced at build time via the `server-only` import in `lib/supabase/admin.ts` |

Add new domain logic tests alongside the function in the same `lib/domain/*.test.ts` pattern — that's the layer designed to be unit-testable without a database.
