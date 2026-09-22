import { redirect } from "next/navigation";
import { getCurrentWorkspace } from "@/lib/workspace";
import { OnboardingForm } from "./onboarding-form";

// See the (app) layout's identical export — this route sits outside that
// layout, so it needs its own.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // No requireUser() gate here — this page IS where an unresolvable owner
  // gets redirected to (see lib/workspace.ts's requireUser()), so gating on
  // it here would just redirect the page to itself. The owner is only
  // actually needed at submit time (createWorkspaceAction), where a failure
  // to resolve one shows a real form error instead.
  const workspace = await getCurrentWorkspace();
  if (workspace) redirect("/dashboard");

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Vamos criar seu workspace</h1>
          <p className="text-muted-foreground text-sm">
            Isso já cria seu funil de vendas, pesos de score, ofertas e templates de mensagem
            padrão — tudo editável depois em Configurações.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </div>
  );
}
