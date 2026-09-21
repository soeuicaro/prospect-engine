# Security

## Row Level Security

Every tenant table has RLS enabled with a policy requiring `is_workspace_member(workspace_id)` — see `DATABASE.md` and `supabase/migrations/0007_rls.sql`. This is enforced by Postgres itself, not by application code, so an IDOR bug in a Server Action cannot leak cross-workspace data as long as the request goes through the anon-key client with the user's session.

## Service-role key

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely.

- Lives only in `lib/supabase/admin.ts`, guarded by the `server-only` import (build fails if this module is ever imported from client code).
- Not currently used by any Server Action in this codebase — every write goes through the RLS-bound client (`lib/supabase/server.ts`) using the caller's own session. The admin client exists for future background-job workers that legitimately need to write across workspace boundaries (e.g. a scheduled digest), and is intentionally unused until that exists, rather than wired in "just in case."
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is safe to expose (RLS protects it); `SUPABASE_SERVICE_ROLE_KEY` must never get a `NEXT_PUBLIC_` prefix.

## Secrets

- `.env.local` is gitignored (`.env*` in `.gitignore`). `.env.example` documents required variables with no real values.
- A committed-secret scanner is not wired into CI in V1 — see `TROUBLESHOOTING.md` for the manual check to run before pushing (`git diff --cached` review) and `ARCHITECTURE.md` Roadmap.

## Input validation

All Server Action inputs are parsed with Zod (`lib/validations/*`) before touching the database. Native `<select>`/checkbox form fields are used (not Radix-only components) specifically so `FormData` actually carries the value server-side — see the `NativeSelect` component comment.

## ⚠️ Auth bypass currently active in this environment

`NEXT_PUBLIC_REQUIRE_AUTH=false` in `.env.local` (temporary, requested to explore the UI before a Supabase project was connected — see `ENVIRONMENT.md`). While this is off, `requireUser()`/`requireWorkspace()` (`lib/workspace.ts`) and `proxy.ts` do not enforce login at all. **This must be set to `true` before deploying anywhere reachable by anyone but you.**

## Authorization boundaries

- `requireUser()` / `requireWorkspace()` (`lib/workspace.ts`) gate every page in the `(app)` route group and every Server Action that touches workspace data.
- `proxy.ts` (Next.js 16's renamed `middleware.ts`) refreshes the Supabase session and redirects unauthenticated requests away from protected routes at the edge of the app, as a second layer — but Server Actions do not rely on `proxy.ts` alone (a matcher change could silently stop covering a route); each action re-checks via `requireWorkspace()`/`requireUser()`.

## Known dependency decision

`xlsx` (SheetJS, npm) has two unpatched high-severity advisories (prototype pollution, ReDoS — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with no fix on the npm registry. It was **not installed**. XLSX import is not implemented in V1 as a result (CSV import covers the same need — see `ARCHITECTURE.md` Roadmap). `npm audit` currently reports 0 vulnerabilities.

## Security checklist (re-verify before calling this "production ready")

- [x] RLS enabled + policy-tested-by-inspection on every tenant table
- [x] Service-role key never imported outside `lib/supabase/admin.ts`
- [x] Zod validation on every Server Action input
- [x] `npm audit` clean
- [ ] RLS policies exercised by an automated integration test against a real Supabase project (not yet — no live project connected in this environment; see `TESTING.md`)
- [ ] Rate limiting on Server Actions (OSM discovery has a documented best-effort limitation only — see `ARCHITECTURE.md`)
- [ ] Security headers (CSP, etc.) configured at the Vercel/Next.js config level (not yet set)
- [ ] Dependency/secret scanning wired into CI

## LGPD / privacy posture

See PROMPT MASTER §20-21 for the source requirements this implements: `suppression_list` (hard do-not-contact gate, checked before every campaign audience build in `lib/actions/campaigns.ts`), `consents` and `data_verification` tables exist in the schema for recording lawful-basis notes and field-level verification status. The product only stores business-context contact info (`RESPONSAVEL_CADASTRAL`/`SOCIO`/`DECISOR_ESTIMADO`/`CONTATO_COMERCIAL` — never inferred as "the owner" without evidence) and never collects passwords, private-account data, or sensitive personal categories. This is not a substitute for legal review before commercial-scale use — see `PROMPT MASTER §154`.
