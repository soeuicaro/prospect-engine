import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessProfileForm } from "./business-profile-form";
import { ScoringWeightsForm } from "./scoring-weights-form";
import { ContactLimitsForm } from "./contact-limits-form";
import { NewIndustryForm } from "./new-industry-form";
import { FeatureFlagsPanel } from "./feature-flags-panel";
import { Badge } from "@/components/ui/badge";

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const [{ data: weights }, { data: industries }] = await Promise.all([
    supabase.from("scoring_category_weights").select("*").eq("workspace_id", workspace.id),
    supabase
      .from("industries")
      .select("id, name, is_visual_segment, recurring_need, workspace_id")
      .or(`workspace_id.is.null,workspace_id.eq.${workspace.id}`)
      .order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Workspace, comercial, prospecção, score, dados e segurança.</p>
      </div>

      <Tabs defaultValue="business">
        <TabsList>
          <TabsTrigger value="business">Perfil comercial</TabsTrigger>
          <TabsTrigger value="scoring">Score</TabsTrigger>
          <TabsTrigger value="niches">Nichos</TabsTrigger>
          <TabsTrigger value="prospecting">Prospecção</TabsTrigger>
          <TabsTrigger value="flags">Integrações & Flags</TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Perfil da agência</CardTitle>
            </CardHeader>
            <CardContent>
              <BusinessProfileForm workspace={workspace} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scoring" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Pesos do Prospect Score</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoringWeightsForm weights={weights ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="niches" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Novo nicho</CardTitle>
            </CardHeader>
            <CardContent>
              <NewIndustryForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Nichos existentes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(industries ?? []).map((i) => (
                <Badge key={i.id} variant="outline">
                  {i.name} {i.workspace_id ? "" : "(padrão)"}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prospecting" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Limites de contato diário</CardTitle>
            </CardHeader>
            <CardContent>
              <ContactLimitsForm limits={workspace.contact_limits} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flags" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Feature Flags (Zero-Cost Guard)</CardTitle>
            </CardHeader>
            <CardContent>
              <FeatureFlagsPanel flags={workspace.feature_flags} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
