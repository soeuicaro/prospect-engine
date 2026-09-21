/**
 * Validates the two public Supabase env vars with a clear, actionable
 * error instead of a cryptic "supabaseUrl is required" thrown deep inside
 * @supabase/ssr. Missing on Vercel almost always means the environment
 * variables were never added in Project Settings → Environment Variables
 * — see ENVIRONMENT.md / DEPLOYMENT.md.
 */
export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY (arquivo .env.local em desenvolvimento, " +
        "ou Project Settings → Environment Variables na Vercel). Veja ENVIRONMENT.md."
    );
  }

  return { url, anonKey };
}
