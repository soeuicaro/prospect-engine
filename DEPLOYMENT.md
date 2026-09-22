# Deployment

## 1. Supabase project

1. Create a free project at <https://supabase.com> (or `vercel integration add supabase` from a linked Vercel project — see the Vercel Marketplace flow, which auto-injects env vars into the Vercel project).
2. In the SQL editor (or via the Supabase CLI), run every file in `supabase/migrations/` **in filename order** (`0001_core.sql` through the latest `000N_*.sql`). Each is idempotent-safe to inspect before running (no `DROP` statements), but they are not designed to be re-run twice as-is (they `CREATE TABLE`, not `CREATE TABLE IF NOT EXISTS`) — run once per fresh project.
3. Project Settings → API: copy the Project URL and the `service_role` secret key. This app has no login flow (see `SECURITY.md`) — the `anon` key isn't used, and you don't need Auth/sign-up configured in Supabase at all.
4. Create the one owner row manually — either via Supabase's Auth → Users → "Add user" (email + password, doesn't matter since nothing ever logs in with it — this just gives you a real `auth.users`/`profiles` row to own the workspace) or by inserting directly into `public.profiles`.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the two Supabase values — see `ENVIRONMENT.md` for what each one is for and where it's allowed to be used.

## 3. Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` — no login, no onboarding form: it goes straight to the dashboard. The first request auto-creates the one workspace behind the scenes (`requireWorkspace()` in `lib/workspace.ts`), seeding pipeline stages, scoring weights, starter offers/templates/playbooks via the `create_workspace()` Postgres function (`supabase/migrations/0006_workspace_bootstrap.sql`, updated in `0009_single_user_bootstrap.sql` to take an explicit owner id instead of a session). Rename it and set its city/state from Configurações whenever.

## 4. Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel (framework auto-detected as Next.js).
3. Add the same two environment variables from `.env.local` in Vercel Project Settings → Environment Variables (all three environments: Production/Preview/Development, or use `vercel env pull`/`vercel env add` from the CLI).
4. Deploy. Next.js 16 on Vercel uses Fluid Compute (Node.js runtime) by default — no special config needed for Server Actions or streaming.

**Do not deploy this to a URL reachable by anyone but you** — there is no login wall (see `SECURITY.md`).

## 5. Post-deploy checklist

- [ ] Visit the production URL and confirm it reaches the dashboard (exercises the DB connection + the auto-created-workspace `create_workspace()` RPC end-to-end)
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` only client-side (never expose `SUPABASE_SERVICE_ROLE_KEY` — it is intentionally never referenced from any `"use client"` file)
- [ ] Re-check current Supabase/Vercel free-tier limits against `FREE_PLAN.md` before high-volume use

## Local dev without Vercel CLI

The Vercel CLI is optional for local development (this repo runs on plain `npm run dev`). It becomes useful for `vercel env pull` (sync env vars from the dashboard) and `vercel deploy` from the terminal — install with `npm i -g vercel` if you want it.
