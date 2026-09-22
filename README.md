# Prospect Engine

> De empresas locais a oportunidades comerciais.

A local B2B prospecting intelligence machine for an audiovisual/social-media production business: turns **city + region + niches + criteria** into a qualified, scored, prioritized pipeline of companies to contact — with decision-maker intelligence, digital-presence analysis, recommended offers, ready-to-send messages, follow-ups and a CRM. Built R$0-first: no paid APIs are required for the core product to work.

See `PROMPT_MASTER` context in project history for the full product spec this was built from. This README covers what actually exists and how to run it.

## Status: MVP implemented

Working end-to-end today:

- Single-user, no login — the one workspace auto-creates itself on first run (see `SECURITY.md`)
- Companies: create, list with filters/search/pagination/bulk actions, detailed lead page
- Prospect Score engine (configurable weights/rules per workspace) with a transparent "Why this lead?" evidence trail
- Decision-maker intelligence with confidence levels (never fabricated)
- Website Analyzer (robots.txt-respecting, single-page fetch): status/flags, social link discovery, gap-fills missing contact fields, feeds the score
- "Open in Google Maps" validation link (never scrapes/stores Maps content)
- Discovery Engine via OpenStreetMap (free, public)
- CSV import with column mapping, dedup detection, tolerant per-row error handling
- CNPJ dataset local preprocessor (`tools/cnpj-importer`, stdlib-only Python)
- Campaigns (filters → audience preview → activate), pipeline stages, campaign leads
- Assisted outreach (WhatsApp/email links, never automated sending) with message templates and auto follow-up scheduling
- CRM: Kanban pipeline (drag & drop), tasks, follow-ups queue, notes, stage history timeline
- Suppression list (do-not-contact) enforced before campaign audiences are built
- Industry playbooks, offers, content ideas (template-based, no AI)
- Settings: business profile, scoring weights, niche builder, contact-rate limits, feature flags (Zero-Cost Guard)
- Audit log on sensitive actions
- Unit tests for the domain logic (scoring, dedup, CNPJ/phone normalization, templates)

Documented as roadmap, not built yet (see `ARCHITECTURE.md` §Roadmap): automated job queue/cron digests, XLSX import, workspace backup/export, command palette, dark mode toggle UI, multi-seat roles beyond the schema.

## Stack

- **Frontend/Backend:** Next.js 16 (App Router, Server Actions, Server Components), TypeScript, Tailwind CSS v4, shadcn/ui
- **Database/Auth:** Supabase (Postgres + Auth), Row Level Security on every tenant table
- **Deploy:** Vercel
- **Validation:** Zod
- **Tests:** Vitest

Next.js 16 renamed `middleware.ts` → `proxy.ts` (session refresh lives in `proxy.ts` + `src/lib/supabase/middleware.ts`) — see `node_modules/next/dist/docs` if anything here looks unfamiliar.

## Quickstart

```bash
npm install
cp .env.example .env.local   # fill in Supabase values, see ENVIRONMENT.md
# Apply supabase/migrations/*.sql to your Supabase project — see DEPLOYMENT.md
npm run dev
```

Then sign up, create a workspace (seeds your pipeline stages, scoring weights, starter offers/templates/playbooks automatically), and either create a company manually, import a CSV, or run a Discovery search.

## Documentation

| File | Covers |
|---|---|
| `ARCHITECTURE.md` | System design, provider abstractions, roadmap |
| `DATABASE.md` | Schema, RLS strategy, indexing |
| `SECURITY.md` | RLS, service-role handling, checklist |
| `DATA_SOURCES.md` | Every external data source and its terms |
| `CNPJ_IMPORT.md` | How to get and import Receita Federal data |
| `MAPS_USAGE.md` | Exactly what we do and don't do with Google Maps |
| `DEPLOYMENT.md` | Supabase + Vercel setup |
| `FREE_PLAN.md` | Zero-cost architecture and current plan limits |
| `TESTING.md` | What's tested and how to run it |
| `TROUBLESHOOTING.md` | Common issues |
| `ENVIRONMENT.md` | Environment variables |

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build (also type-checks)
npm run lint      # ESLint
npm test         # Vitest unit tests
```
