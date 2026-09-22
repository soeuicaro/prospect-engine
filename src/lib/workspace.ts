import "server-only";
import { cache } from "react";
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
 */
export const getOwnerUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, email").limit(1).maybeSingle();
  if (!data) return null;
  return { id: data.id, email: data.email ?? "" };
});

/** Single-workspace app: returns the one workspace that exists, or null before it's been created yet. */
export const getCurrentWorkspace = cache(async (): Promise<Workspace | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("*").limit(1).maybeSingle();
  return data ?? null;
});

/**
 * Use in Server Components/Actions that need "the current user" (really:
 * the one fixed owner) — mainly for `created_by`/`author_id`-style columns
 * and the Topbar's name/email display.
 *
 * Throws if no owner can be resolved — this genuinely can't be recovered
 * from (there used to be a manual "create your account" step to fall back
 * to; there isn't one anymore, on purpose — see `requireWorkspace()`), so
 * it surfaces as the app's error.tsx screen instead of silently degrading.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getOwnerUser();
  if (user) return user;
  throw new Error(
    "Nenhuma conta encontrada em `profiles`, ou não foi possível falar com o Supabase. " +
      "Confira NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (ENVIRONMENT.md)."
  );
}

/**
 * Use in Server Components/Actions that require an active workspace.
 *
 * There's no onboarding screen — this app is single-workspace, single-user,
 * so the first request that doesn't find a workspace just creates one
 * (via the `create_workspace()` RPC, same one an onboarding form used to
 * call) with a placeholder name, and every request after that finds it.
 * Rename it — and set city/state — from Configurações whenever.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const existing = await getCurrentWorkspace();
  if (existing) return existing;

  const owner = await requireUser();
  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", {
    p_name: "Meu Workspace",
    p_owner_id: owner.id,
  });

  if (error || !workspaceId) {
    throw new Error(
      `Não foi possível criar o workspace automaticamente${error ? `: ${error.message}` : ""}.`
    );
  }

  // Not `getCurrentWorkspace()` again — it's `cache()`-memoized per request
  // and already resolved to null above in this same render pass.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .single();

  if (!workspace) {
    throw new Error("Workspace criado, mas não encontrado logo em seguida — recarregue a página.");
  }

  return workspace;
}
