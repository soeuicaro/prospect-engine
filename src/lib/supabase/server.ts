import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { getSupabasePublicEnv } from "./env";

/**
 * Server Supabase client for Server Components, Server Actions and Route
 * Handlers. Uses the anon key + the caller's session cookie — RLS still
 * applies. This is the client that ~99% of server code should use.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component with no response to write to.
          // Safe to ignore: proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
