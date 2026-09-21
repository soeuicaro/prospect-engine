/**
 * Resolves the two public Supabase env vars, falling back to a safe,
 * syntactically-valid placeholder instead of throwing when they're
 * missing (e.g. Vercel env vars not configured yet, or NEXT_PUBLIC_
 * placeholders in local .env.local before a real project is connected).
 *
 * Why fall back instead of throwing: this app calls createClient() from
 * dozens of pages/actions, and .env.local is gitignored — it never reaches
 * Vercel on its own. Throwing here would crash every single page with a
 * server-side exception the moment env vars are absent, which is strictly
 * worse than degrading: Supabase-js's query methods already fail *inside*
 * their own {data, error} response shape (not by throwing) when the host
 * is unreachable, so the rest of the app's `data ?? []` / `?? null`
 * patterns render empty states instead of crashing. A `console.warn` here
 * makes the misconfiguration visible in logs either way.
 */
export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.warn(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL/ANON_KEY not set — using a non-functional placeholder. " +
        "Every Supabase call will fail gracefully (empty results), not crash. " +
        "Set real values in .env.local (local) and Vercel Project Settings → Environment Variables (deployed). See ENVIRONMENT.md."
    );
    return { url: url || "http://127.0.0.1:59999", anonKey: anonKey || "unconfigured-anon-key" };
  }

  return { url, anonKey };
}
