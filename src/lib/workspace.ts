import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";
import type { User } from "@supabase/supabase-js";

/**
 * TEMPORARY DEV BYPASS — requested to explore the UI before a real
 * Supabase project is connected (no live auth/database yet). Set
 * NEXT_PUBLIC_REQUIRE_AUTH=true in .env.local to turn login back into a
 * hard requirement once real Supabase credentials are wired up; this must
 * be re-enabled before any real deployment (see SECURITY.md).
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
 * MVP is single-workspace-per-user (multi-workspace UI can be added later
 * without a schema change — workspace_members already supports it). Returns
 * the first workspace the current user belongs to, or null.
 */
export async function getCurrentWorkspace(): Promise<Workspace | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

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
}

/** Use in Server Components/Actions that require an active workspace. */
export async function requireWorkspace(): Promise<Workspace> {
  const workspace = await getCurrentWorkspace();
  if (workspace) return workspace;
  if (!REQUIRE_AUTH) return GUEST_WORKSPACE;
  redirect("/onboarding");
}

export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user;
  if (!REQUIRE_AUTH) return GUEST_USER;
  redirect("/login");
}
