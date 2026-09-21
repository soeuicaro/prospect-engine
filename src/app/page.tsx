import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Mirrors the bypass in lib/workspace.ts / lib/supabase/middleware.ts — see
// those files' comments. Must be "true" before any real deployment.
const REQUIRE_AUTH = process.env.NEXT_PUBLIC_REQUIRE_AUTH === "true";

export default async function Home() {
  if (!REQUIRE_AUTH) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
