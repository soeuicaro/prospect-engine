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
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL missing. " +
        "The admin client must not be used until Supabase is provisioned."
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
