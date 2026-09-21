# Deployment

## 1. Supabase project

1. Create a free project at <https://supabase.com> (or `vercel integration add supabase` from a linked Vercel project — see the Vercel Marketplace flow, which auto-injects env vars into the Vercel project).
2. In the SQL editor (or via the Supabase CLI), run every file in `supabase/migrations/` **in filename order** (`0001_core.sql` through `0008_seed_reference.sql`). Each is idempotent-safe to inspect before running (no `DROP` statements), but they are not designed to be re-run twice as-is (they `CREATE TABLE`, not `CREATE TABLE IF NOT EXISTS`) — run once per fresh project.
3. Confirm Auth is enabled with email/password sign-up (default in Supabase — no extra config needed for this app).
4. Project Settings → API: copy the Project URL, `anon` public key, and `service_role` secret key.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the three Supabase values — see `ENVIRONMENT.md` for what each one is for and where it's allowed to be used.

## 3. Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, sign up, and create your workspace — this seeds your pipeline stages, scoring weights, starter offers/templates/playbooks via the `create_workspace()` Postgres function (`supabase/migrations/0006_workspace_bootstrap.sql`).

## 4. Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel (framework auto-detected as Next.js).
3. Add the same three environment variables from `.env.local` in Vercel Project Settings → Environment Variables (all three environments: Production/Preview/Development, or use `vercel env pull`/`vercel env add` from the CLI).
4. Deploy. Next.js 16 on Vercel uses Fluid Compute (Node.js runtime) by default — no special config needed for Server Actions, `proxy.ts`, or streaming.

## 5. Post-deploy checklist

- [ ] Sign up on the production URL and confirm workspace creation works (exercises the DB connection + `create_workspace()` RPC end-to-end)
- [ ] Confirm RLS: sign up a second account, confirm it cannot see the first account's workspace data
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` only (never expose `SUPABASE_SERVICE_ROLE_KEY` client-side — it is intentionally never referenced from any `"use client"` file)
- [ ] Re-check current Supabase/Vercel free-tier limits against `FREE_PLAN.md` before high-volume use

## Local dev without Vercel CLI

The Vercel CLI is optional for local development (this repo runs on plain `npm run dev`). It becomes useful for `vercel env pull` (sync env vars from the dashboard) and `vercel deploy` from the terminal — install with `npm i -g vercel` if you want it.
