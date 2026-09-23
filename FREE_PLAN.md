# Free Plan / Zero-Cost Architecture

## Philosophy: ZERO-COST GUARD

`workspaces.cost_mode` defaults to `FREE_ONLY` (see `supabase/migrations/0001_core.sql`). Every external integration in this codebase is either free, optional, or substitutable. Nothing in the core flow (discover → analyze → score → prioritize → message → follow up → CRM) requires a paid API key. `workspaces.feature_flags` lets an admin disable any optional integration outright (Settings → Integrações & Flags).

**Never in this codebase:** a call to a paid AI API (OpenAI/Claude/Gemini), a paid leads/enrichment API (Apollo, Hunter, SerpAPI, Bright Data), a paid WhatsApp/SMS API, stored payment/card details, or an integration that upgrades itself without explicit admin action.

## What's actually used, and its plan

| Service | Plan | What for |
|---|---|---|
| Supabase | Free tier | Postgres + Auth |
| Vercel | Hobby (free) | Hosting, Functions |
| OpenStreetMap (Nominatim + Overpass) | Free, public | Discovery |
| Receita Federal Dados Abertos | Free, public | CNPJ import (local preprocessing) |
| Overture Maps Places | Free, open data (CDLA-Permissive-2.0), no key | Business places per city (`npm run places:sync`) |
| Google Maps | Free (public URL, no API key) | Validation link only |

No credit card is required anywhere in this stack to run the MVP.

## Current documented limits (verify before relying on exact numbers — plans change)

As of this writing, check the official current limits before scaling usage:

- **Supabase free tier:** <https://supabase.com/pricing> — database size, bandwidth/egress, and pausing-after-inactivity behavior for free projects all matter here. A paused free project needs to be manually un-paused from the dashboard; nothing in this app auto-recovers from a paused database.
- **Vercel Hobby plan:** <https://vercel.com/docs/limits/overview> — Function execution duration/count, bandwidth.
- **Nominatim usage policy:** <https://operations.osmfoundation.org/policies/nominatim/> — ~1 req/sec, requires a descriptive User-Agent (already set in `lib/providers/osm.ts`).
- **Overpass API:** shares fair-use expectations with Nominatim; avoid tight request loops.

**Do not assume these numbers stay the same** — re-check the linked docs before a large rollout, and treat any number in this file as "true as of when someone last verified it," not a permanent contract.

## What happens if a free tier changes or a service disappears

- **Supabase database size limit hit:** storage-economy decisions in `DATABASE.md` (no raw HTML, no images) exist specifically to push this out as far as possible. If it's still hit, the CNPJ/OSM import tooling already filters aggressively — narrow the `--uf`/`--cnae` filters further, or archive/delete old inactive leads (`archived_at`/`deleted_at` already exist).
- **Vercel Function timeout tightened:** the CSV importer already caps at 2,000 rows/request specifically to stay well under current limits with margin — see `ARCHITECTURE.md`.
- **Nominatim/Overpass become unavailable or rate-limit harder:** Discovery is one clearly isolated file (`lib/providers/osm.ts`) — the rest of the product (manual entry, CSV/CNPJ import, campaigns, CRM) works with zero changes if this integration is disabled via the `OSM_DISCOVERY` feature flag.
- **A paid upgrade becomes unavoidable at scale:** that is an explicit admin decision (`cost_mode: MANUAL_OVERRIDE`), never an automatic one triggered by the app itself.

## Cost Safety in code

- `workspaces.cost_mode` (`FREE_ONLY` default) and `workspaces.feature_flags` are read from Settings → Integrações & Flags (`src/app/(app)/settings/feature-flags-panel.tsx`) and can gate any future paid-adjacent feature the same way `OSM_DISCOVERY` gates discovery today.
- No dependency in `package.json` requires a paid account to install or run (`npm audit`: 0 vulnerabilities, no telemetry/paid SaaS SDKs).
