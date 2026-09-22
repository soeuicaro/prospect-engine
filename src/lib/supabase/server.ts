import "server-only";
import { createAdminClient } from "./admin";

/**
 * This app is single-user and session-less by design (no login/signup flow
 * — see lib/workspace.ts). There is no Supabase Auth session to bind a
 * request-scoped client to, so every server-side caller gets the
 * service-role client instead. `createClient()` is kept as the import
 * every Server Component/Action/query already uses, so nothing else in the
 * app had to change — only what it returns did.
 *
 * This intentionally bypasses Row Level Security everywhere, which is fine
 * here: there's exactly one workspace and one operator with access to the
 * server at all. RLS policies (`supabase/migrations/0007_rls.sql`) are still
 * in the schema but effectively unused now — they'd only matter again if
 * this app ever grows a real multi-user login flow.
 */
export async function createClient() {
  return createAdminClient();
}
