import { redirect } from "next/navigation";
import { requireUser } from "@/lib/workspace";
import { getCurrentWorkspace } from "@/lib/workspace";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  await requireUser();
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
