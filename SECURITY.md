# Security

## No login — single-user by design

This app has no login/signup flow at all (deliberately removed — it's only ever run by one operator). There is no session, no password, no `NEXT_PUBLIC_REQUIRE_AUTH` flag anymore. **Do not deploy this anywhere reachable by anyone but you** unless you add real authentication back — anyone who can reach the deployed URL has full access, full stop. The `(app)` route group has no gate beyond `requireWorkspace()`/`requireUser()` (`lib/workspace.ts`) redirecting to `/onboarding` when the one workspace doesn't exist yet — that's a setup-flow redirect, not an authorization check.

## Row Level Security

Every tenant table still has RLS enabled with a policy requiring `is_workspace_member(workspace_id)` — see `DATABASE.md` and `supabase/migrations/0007_rls.sql`. **This is no longer the app's enforcement boundary.** The app has no login flow (single operator by design — see `lib/workspace.ts`), so every request goes through the service-role client, which bypasses RLS entirely. The policies are left in the schema (harmless, and they'd matter again if this app ever grows a real multi-user login), but the actual security boundary today is: only someone with access to the deployed server / the Supabase project itself can touch the data.

## Service-role key

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely, and is now the key every server-side request uses (not just background jobs).

- Constructed only in `lib/supabase/admin.ts`, guarded by the `server-only` import (build fails if this module is ever imported from client code). `lib/supabase/server.ts`'s `createClient()` — the function every Server Component/Action/query calls — just returns this client.
- Since there's no more RLS enforcement in the request path, every write in `lib/actions/*.ts` MUST keep explicitly filtering/setting `workspace_id` itself — RLS will not do it for you, and now nothing else will either.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is no longer used anywhere in the app (no anon-key client exists); it's harmless to leave in `.env.local` but can be removed. `SUPABASE_SERVICE_ROLE_KEY` must never get a `NEXT_PUBLIC_` prefix — it is meaningfully more sensitive now that it's the app's only Supabase credential.

## Secrets

- `.env.local` is gitignored (`.env*` in `.gitignore`). `.env.example` documents required variables with no real values.
- A committed-secret scanner is not wired into CI in V1 — see `TROUBLESHOOTING.md` for the manual check to run before pushing (`git diff --cached` review) and `ARCHITECTURE.md` Roadmap.

## Input validation

All Server Action inputs are parsed with Zod (`lib/validations/*`) before touching the database. Native `<select>`/checkbox form fields are used (not Radix-only components) specifically so `FormData` actually carries the value server-side — see the `NativeSelect` component comment.

## Authorization boundaries

- `requireUser()` / `requireWorkspace()` (`lib/workspace.ts`) resolve the one fixed owner/workspace and redirect to `/onboarding` if the workspace hasn't been created yet. They are not an access-control gate (see above).
- Every Server Action in `lib/actions/*.ts` still explicitly scopes its queries/writes to `workspace_id` — that discipline is kept even though RLS/auth no longer enforces it, since it's the only thing preventing cross-workspace data mixing if this ever becomes multi-workspace again.

## Known dependency decision

`xlsx` (SheetJS, npm) has two unpatched high-severity advisories (prototype pollution, ReDoS — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with no fix on the npm registry. It was **not installed**. XLSX import is not implemented in V1 as a result (CSV import covers the same need — see `ARCHITECTURE.md` Roadmap). `npm audit` currently reports 0 vulnerabilities.

## Security checklist (re-verify before calling this "production ready")

- [x] RLS policies still defined on every tenant table (inert while the service-role client is used — see "No login" above)
- [x] Service-role key only constructed in `lib/supabase/admin.ts`, never imported from client code
- [x] Zod validation on every Server Action input
- [x] `npm audit` clean
- [ ] Real authentication before this is ever deployed somewhere reachable by anyone but the one operator
- [ ] Rate limiting on Server Actions (OSM discovery has a documented best-effort limitation only — see `ARCHITECTURE.md`)
- [ ] Security headers (CSP, etc.) configured at the Vercel/Next.js config level (not yet set)
- [ ] Dependency/secret scanning wired into CI

## LGPD / privacy posture

See PROMPT MASTER §20-21 for the source requirements this implements: `suppression_list` (hard do-not-contact gate, checked before every campaign audience build in `lib/actions/campaigns.ts`), `consents` and `data_verification` tables exist in the schema for recording lawful-basis notes and field-level verification status. The product only stores business-context contact info (`RESPONSAVEL_CADASTRAL`/`SOCIO`/`DECISOR_ESTIMADO`/`CONTATO_COMERCIAL` — never inferred as "the owner" without evidence) and never collects passwords, private-account data, or sensitive personal categories. This is not a substitute for legal review before commercial-scale use — see `PROMPT MASTER §154`.
