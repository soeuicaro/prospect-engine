import { requireWorkspace } from "@/lib/workspace";
import { listIndustries, listOffers, listMessageTemplates, listOutreachSequences } from "@/lib/queries/industries";
import { NewCampaignForm } from "./new-campaign-form";

export default async function NewCampaignPage() {
  const workspace = await requireWorkspace();
  const [industries, offers, templates, sequences] = await Promise.all([
    listIndustries(workspace.id),
    listOffers(workspace.id),
    listMessageTemplates(workspace.id),
    listOutreachSequences(workspace.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova campanha</h1>
        <p className="text-sm text-muted-foreground">
          Ex: &ldquo;Quero 100 restaurantes de Sobral com alta necessidade de conteúdo.&rdquo;
        </p>
      </div>
      <NewCampaignForm industries={industries} offers={offers} templates={templates} sequences={sequences} />
    </div>
  );
}
