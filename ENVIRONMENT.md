# Environment Variables

All three come from a Supabase project (Project Settings → API). See `.env.example` for the file to copy.

| Variable | Exposed to browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Used by every client (browser, server, admin). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key. Safe to expose — every query made with it is still subject to Row Level Security (`DATABASE.md`). Used by `lib/supabase/client.ts` and `lib/supabase/server.ts`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **No — never** | Bypasses RLS entirely. Used only by `lib/supabase/admin.ts`, guarded at build time by the `server-only` package import. Do not reference this from any file with a `"use client"` directive. See `SECURITY.md`. |
| `NEXT_PUBLIC_REQUIRE_AUTH` | Yes | **Must be `"true"` for any real/production use.** When unset or anything else, `lib/workspace.ts` and `lib/supabase/middleware.ts` skip the login/workspace requirement entirely and fall back to a synthetic "Guest Workspace" so the UI can be explored before a real Supabase project is connected. This is a temporary development convenience, not a security feature — see the next section. |

## Auth bypass (temporary, development only)

`NEXT_PUBLIC_REQUIRE_AUTH=false` (or unset) is currently the default in `.env.local` in this repo, at the user's request, to allow browsing the UI before a real Supabase project exists. While it's off:

- Every protected route renders without a login, using a synthetic guest user/workspace (`GUEST_USER`/`GUEST_WORKSPACE` in `lib/workspace.ts`).
- All data queries still go through Supabase — against the placeholder credentials in `.env.local`, they fail gracefully and pages render empty states rather than real data. Once a real Supabase project is connected but `NEXT_PUBLIC_REQUIRE_AUTH` is still `false`, every visitor would see the **same** guest workspace with **no login wall** — this is fine for solo local exploration, but is not a safe configuration for anything reachable by other people.

**Set `NEXT_PUBLIC_REQUIRE_AUTH=true` before deploying anywhere reachable by anyone but you.** See `SECURITY.md`.

## Local setup

```bash
cp .env.example .env.local
```

Fill in the three values. `.env.local` is gitignored — never commit it.

## Vercel setup

Add the same three variables in Project Settings → Environment Variables for each environment you deploy to (Production/Preview/Development), or via the CLI:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env pull .env.local   # sync back down for local dev, if using Vercel-managed Supabase
```

## Placeholder values during development without a live project

This repo currently ships a `.env.local` with placeholder-looking values (`https://placeholder.supabase.co`, etc.) purely so `npm run build` can type-check and prerender static routes without a live Supabase project connected. **Replace these with real values before running the app** — every data-fetching page is a Server Component/Action that will fail at request time against a placeholder URL. See `DEPLOYMENT.md` for provisioning a real project.
