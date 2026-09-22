import { redirect } from "next/navigation";

// No login flow — single-user app. The (app) layout's requireWorkspace()
// bounces to /onboarding on its own if the one workspace doesn't exist yet.
export default function Home() {
  redirect("/dashboard");
}
