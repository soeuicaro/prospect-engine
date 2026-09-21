import { requireWorkspace } from "@/lib/workspace";
import { listIndustries } from "@/lib/queries/industries";
import { NewCompanyForm } from "./new-company-form";

export default async function NewCompanyPage() {
  const workspace = await requireWorkspace();
  const industries = await listIndustries(workspace.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova empresa</h1>
        <p className="text-sm text-muted-foreground">
          Cadastro manual. O score de prospecção é calculado automaticamente ao salvar.
        </p>
      </div>
      <NewCompanyForm industries={industries} />
    </div>
  );
}
