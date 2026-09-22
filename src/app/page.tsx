import { redirect } from "next/navigation";

// No login, no onboarding — single-user, single-workspace app. The (app)
// layout's requireWorkspace() creates the one workspace on the fly the
// first time it's needed.
export default function Home() {
  redirect("/dashboard");
}
