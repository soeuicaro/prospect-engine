import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getSupabasePublicEnv } from "./env";

/**
 * Browser Supabase client. Uses the anon key only — RLS enforces isolation.
 * Never import the service-role client (`lib/supabase/admin.ts`) here.
 */
export function createClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
