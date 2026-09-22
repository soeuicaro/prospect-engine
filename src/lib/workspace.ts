import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";

/**
 * This app is single-user by design (see the user's own decision — no
 * login/signup flow, only ever run by one operator) and every server call
 * already goes through the service-role client (lib/supabase/server.ts),
 * which has no Supabase Auth session/JWT at all. There is exactly one real
 * row in `profiles` (the one account created before this was simplified);
 * that's "the user" everywhere in the app now. Only `id`/`email` are used
 * anywhere (Topbar display, `created_by`/`author_id`/etc. FK columns), so
 * this doesn't need the full `@supabase/supabase-js` `User` shape.
 */
export interface AppUser {
  id: string;
  email: string;
}

/**
 * `getUser()`/`getWorkspace()` are called from the layout and from every
 * page/action that needs them. `cache()` memoizes each per request (per
 * React render pass) so hitting the DB for "who's the owner"/"what's the
 * workspace" multiple times during one request only costs one round trip
 * each, however many call sites ask for it.
 */
const getOwnerUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, email").limit(1).maybeSingle();
  if (!data) return null;
  return { id: data.id, email: data.email ?? "" };
});

/**
 * Single-workspace app: returns the one workspace that exists, or null
 * before onboarding has created it yet.
 */
export const getCurrentWorkspace = cache(async (): Promise<Workspace | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("*").limit(1).maybeSingle();
  return data ?? null;
});

/** Use in Server Components/Actions that require an active workspace. */
export async function requireWorkspace(): Promise<Workspace> {
  const workspace = await getCurrentWorkspace();
  if (workspace) return workspace;
  redirect("/onboarding");
}

/**
 * Use in Server Components/Actions that need "the current user" (really:
 * the one fixed owner) — mainly for `created_by`/`author_id`-style columns
 * and the Topbar's name/email display.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getOwnerUser();
  if (user) return user;
  // No `profiles` row exists yet — nothing has ever signed up. Onboarding
  // needs an owner id to pass to create_workspace(); without one there's
  // nothing this app can do.
  throw new Error(
    "No owner account found in `profiles`. This app expects exactly one row there — see supabase/migrations/0001_core.sql."
  );
}
