# Environment Variables

Two come from a Supabase project (Project Settings → API). See `.env.example` for the file to copy.

| Variable | Exposed to browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Used by `lib/supabase/admin.ts` (the only Supabase client in the app — see below). |
| `SUPABASE_SERVICE_ROLE_KEY` | **No — never** | Bypasses RLS entirely. Used by `lib/supabase/admin.ts`, guarded at build time by the `server-only` package import. Do not reference this from any file with a `"use client"` directive. See `SECURITY.md`. |

`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_REQUIRE_AUTH` are no longer used — this app has no login flow and no anon-key client (see next section). Safe to leave them in `.env.local` (harmless) or remove them.

## No login (see `SECURITY.md`)

This app has no login/signup flow — it's built to be run by one operator only. Every server request goes through the service-role client (`lib/supabase/admin.ts`, wired in via `lib/supabase/server.ts`), which bypasses RLS entirely. There is no session, no guest-workspace fallback, no auth flag to flip. **Do not deploy this anywhere reachable by anyone but you** unless real authentication is added back.

## Local setup

```bash
cp .env.example .env.local
```

Fill in the two values. `.env.local` is gitignored — never commit it.

## Vercel setup

Add the same two variables in Project Settings → Environment Variables for each environment you deploy to (Production/Preview/Development), or via the CLI:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env pull .env.local   # sync back down for local dev, if using Vercel-managed Supabase
```

## Placeholder values during development without a live project

This repo currently ships a `.env.local` with placeholder-looking values (`https://placeholder.supabase.co`, etc.) purely so `npm run build` can type-check and prerender static routes without a live Supabase project connected. **Replace these with real values before running the app** — every data-fetching page is a Server Component/Action that will fail at request time against a placeholder URL. See `DEPLOYMENT.md` for provisioning a real project.
