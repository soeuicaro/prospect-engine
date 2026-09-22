import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * SERVICE-ROLE client. Bypasses Row Level Security entirely.
 *
 * This app has no login/signup flow (single operator, see lib/workspace.ts)
 * so this is now the client for *all* server-side data access, via
 * `lib/supabase/server.ts`'s `createClient()` — not just background jobs.
 *
 * Rules (see SECURITY.md):
 * - Import ONLY from server-only code: Route Handlers, Server Actions,
 *   background job workers. Never import from a Client Component, and never
 *   let this module's output reach the browser bundle (the `server-only`
 *   import enforces this at build time).
 * - Every write through this client MUST explicitly filter/set
 *   workspace_id itself, since RLS will not do it for you.
 *
 * Fails soft (never throws) if the env vars aren't set, with a
 * non-functional placeholder — every query made with it then fails
 * gracefully inside its own `{data, error}` shape instead of throwing, so
 * pages render empty states rather than crashing. This used to throw, back
 * when this client was only reached from a handful of background-job call
 * sites; now that it backs *every* request, a hard throw here means the
 * whole app 500s on every single page the moment these vars are unset —
 * which happens by default on any fresh deploy, since `.env.local` never
 * leaves this machine on its own (see ENVIRONMENT.md/DEPLOYMENT.md).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.warn(
      "[supabase] SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set — using a " +
        "non-functional placeholder. Every Supabase call will fail gracefully (empty results), " +
        "not crash. Set real values in .env.local (local) and your host's environment variables " +
        "(deployed). See ENVIRONMENT.md."
    );
  }

  return createSupabaseClient<Database>(
    url || "http://127.0.0.1:59999",
    serviceRoleKey || "unconfigured-service-role-key",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
