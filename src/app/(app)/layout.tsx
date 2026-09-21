import { requireUser, requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireUser()/requireWorkspace() share a single, per-request-memoized
  // auth.getUser() call (see lib/workspace.ts), so running them concurrently
  // here doesn't double the Supabase Auth round-trip — it just lets the
  // profile query below start as soon as the user id is known instead of
  // waiting for the workspace lookup too.
  const [user, workspace] = await Promise.all([requireUser(), requireWorkspace()]);

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar workspaceName={workspace.name} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar
          userName={profile?.full_name || user.email || "Usuário"}
          userEmail={profile?.email || user.email || ""}
        />
        <main className="flex-1 overflow-y-auto bg-muted/10 p-6">{children}</main>
      </div>
    </div>
  );
}
