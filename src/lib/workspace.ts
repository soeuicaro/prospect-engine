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
 * `getOwnerUser()`/`getCurrentWorkspace()` are called from the layout and
 * from every page/action that needs them. `cache()` memoizes each per
 * request (per React render pass) so hitting the DB for "who's the
 * owner"/"what's the workspace" multiple times during one request only
 * costs one round trip each, however many call sites ask for it.
 *
 * Returns null both when no `profiles` row exists yet AND when Supabase
 * itself is unreachable/unconfigured (`lib/supabase/admin.ts` fails soft,
 * not throws, so a query against a missing/wrong env var resolves to
 * `{data: null}` here rather than rejecting) — exported directly (not just
 * through `requireUser()`) for `onboarding/actions.ts`, which needs to tell
 * those two cases apart from a normal caller's-page form error rather than
 * a redirect.
 */
export const getOwnerUser = cache(async (): Promise<AppUser | null> => {
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
 *
 * Redirects to `/onboarding` instead of throwing when no owner can be
 * resolved (same shape as `requireWorkspace()`) — this can't be told apart
 * from "Supabase isn't reachable right now" (see `getOwnerUser()`), and a
 * throw here would crash every single page the moment that's true, exactly
 * the failure mode `lib/supabase/admin.ts` was fixed to fail soft against.
 * `onboarding/actions.ts` calls `getOwnerUser()` directly instead, since a
 * silent bounce back to the same page it's already on would hide the error
 * rather than show it.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getOwnerUser();
  if (user) return user;
  redirect("/onboarding");
}
