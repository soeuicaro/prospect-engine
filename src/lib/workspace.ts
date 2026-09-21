import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";
import type { User } from "@supabase/supabase-js";

/**
 * TEMPORARY DEV BYPASS — requested to explore the UI before a real
 * Supabase project is connected (no live auth/database yet). Set
 * NEXT_PUBLIC_REQUIRE_AUTH=true once real Supabase credentials are wired
 * up (both locally in .env.local AND in Vercel's Project Settings →
 * Environment Variables — .env.local never leaves your machine). This
 * must be re-enabled before any real deployment (see SECURITY.md).
 */
const REQUIRE_AUTH = process.env.NEXT_PUBLIC_REQUIRE_AUTH === "true";

const GUEST_WORKSPACE_ID = "00000000-0000-0000-0000-000000000000";

const GUEST_USER = {
  id: GUEST_WORKSPACE_ID,
  email: "guest@local",
  app_metadata: {},
  user_metadata: {},
  aud: "guest",
  created_at: new Date().toISOString(),
} as unknown as User;

const GUEST_WORKSPACE: Workspace = {
  id: GUEST_WORKSPACE_ID,
  name: "Guest Workspace (sem Supabase conectado)",
  slug: null,
  city: null,
  state: null,
  logo_url: null,
  signature: null,
  tone_of_voice: "consultivo",
  business_profile: {},
  cost_mode: "FREE_ONLY",
  feature_flags: {
    MAPS_LINKS: true,
    WEB_ANALYSIS: true,
    OSM_DISCOVERY: true,
    CNPJ_IMPORT: true,
    EMAIL_ASSIST: true,
    WHATSAPP_ASSIST: true,
    AI_DISABLED: true,
    LOCAL_AI: false,
    ADVANCED_AUTOMATION: false,
  },
  contact_limits: { max_contacts_per_day: 40, max_new_contacts_per_day: 20, max_followups_per_day: 30 },
  data_retention: {},
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
};

/**
 * `supabase.auth.getUser()` is a network round-trip to the Supabase Auth
 * server (it validates the JWT server-side, it doesn't just decode the
 * cookie). The layout and every page each ask "who is the user?" and "what
 * is their workspace?" independently, which used to mean 2-3 of these
 * round-trips, sequentially, before a single byte of the page could render.
 * `cache()` memoizes this per request (per React render pass), so no matter
 * how many times requireUser()/requireWorkspace() are called while
 * rendering one route, the Auth server is only hit once.
 */
const getAuthUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    // Supabase not configured/reachable — treat as signed out instead of
    // crashing the page.
    return null;
  }
});

/**
 * MVP is single-workspace-per-user (multi-workspace UI can be added later
 * without a schema change — workspace_members already supports it). Returns
 * the first workspace the current user belongs to, or null.
 *
 * Never throws: if Supabase isn't configured/reachable, this resolves to
 * null (as if no workspace exists yet) instead of crashing the page — the
 * dev bypass in requireWorkspace() below is what actually decides what to
 * do about that. Memoized per request via cache() — see getAuthUser() above.
 */
export const getCurrentWorkspace = cache(async (): Promise<Workspace | null> => {
  try {
    const user = await getAuthUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!membership) return null;

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", membership.workspace_id)
      .maybeSingle();

    return workspace ?? null;
  } catch {
    return null;
  }
});

/** Use in Server Components/Actions that require an active workspace. */
export async function requireWorkspace(): Promise<Workspace> {
  const workspace = await getCurrentWorkspace();
  if (workspace) return workspace;
  if (!REQUIRE_AUTH) return GUEST_WORKSPACE;
  redirect("/onboarding");
}

export async function requireUser(): Promise<User> {
  const user = await getAuthUser();
  if (user) return user;
  if (!REQUIRE_AUTH) return GUEST_USER;
  redirect("/login");
}
