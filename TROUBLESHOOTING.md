# Troubleshooting

## "Cannot find package 'vite'" when running `npm test`

Vitest 5 needs `vite` as a peer dependency and it isn't always auto-installed. Fixed already in this repo's `devDependencies`, but if it recurs: `npm install -D vite`.

## `npm install` reports a peer-dependency conflict on `@types/node`

Seen once during setup between the declared `@types/node@^20` and a transitively-hoisted newer version. Safe to resolve with `npm install --legacy-peer-deps` for dev-only tooling packages (this does not affect the production bundle).

## Build fails with `SelectQueryError: could not find the relation between X and Y`

The hand-authored `src/types/database.ts` requires every table used in a Supabase `.select("..., related(...)")` embedded query to declare its FK `Relationships` explicitly (see the `Fk<...>` helper and the comment above `Table<Row, Rel>`). If you add a new embedded select, add the matching `Fk<>` entry for that table, matching Postgres's default constraint name (`<table>_<column>_fkey` for a plain inline `references` clause).

## TypeScript says a Supabase query returns `never`

Almost always means `src/types/database.ts` and the actual migration went out of sync (a new table/column exists in SQL but not in the hand-authored type, or vice versa), OR a `Row` type was declared with `interface` instead of `type`. Interfaces do **not** satisfy Supabase's `Record<string, unknown>` structural constraint in this TypeScript version — every Row type here must be `export type X = { ... }`, not `export interface X { ... }`. This cost real debugging time once already; don't reintroduce it.

## `npm audit` shows a vulnerability after adding a new package

Check if it's the known `xlsx` (SheetJS) issue before doing anything else — see `SECURITY.md`. For any other package, prefer removing/replacing it over installing with a known unpatched high-severity advisory.

## Local dev: "Supabase client error" / blank pages after `npm run dev`

`.env.local` almost certainly has placeholder values (`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`, etc., used only to satisfy the build in an environment with no live project). Fill in real values from a Supabase project — see `DEPLOYMENT.md` §1-2 and `ENVIRONMENT.md`.

## Dashboard shows the error.tsx screen instead of loading ("could not create workspace")

`requireWorkspace()` (`lib/workspace.ts`) auto-creates the one workspace via `create_workspace()` the first time it's needed — no onboarding form anymore. Confirm all migrations ran in order (`0001` through the latest `000N`) — `create_workspace()` (defined in `0006`, updated in `0009` to not need a session) references `industries` rows seeded in `0008`, and `scoring_category_weights`/`pipeline_stages` tables from `0002`. If migrations were run out of order, drop and recreate the project rather than trying to patch mid-sequence.

## CSV import silently skips rows

Check the **Import History** card on `/imports` — `error_count` and `duplicate_count` are both real, intentional outcomes (not a bug): required fields missing (`trade_name`/`city`/`state`) go to `error_count` with the reason in `import_errors`; anything matching an existing company at `EXACT_MATCH`/`LIKELY_MATCH` confidence goes to `duplicate_count` and is skipped on purpose (see `lib/domain/dedup.ts`).

## OpenStreetMap discovery returns 0 results or errors

- Confirm the city name resolves on Nominatim directly (search it at nominatim.openstreetmap.org) — very small towns or unusual spellings sometimes don't geocode.
- Overpass API occasionally rate-limits under load; wait a few seconds and retry (there is no automatic retry/backoff in V1 — see `ARCHITECTURE.md` for why).
- Confirm the `OSM_DISCOVERY` feature flag is enabled in Settings → Integrações & Flags.

## "Cannot use import statement outside a module" or similar in `vitest.config.ts`

Cosmetic warning only (Vite's native config loader flags ESM syntax in a `.ts` file loaded as CJS) — does not affect whether tests actually run. Safe to ignore, or set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true`.
