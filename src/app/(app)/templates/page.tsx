import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { listIndustries } from "@/lib/queries/industries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewTemplateForm } from "./new-template-form";

export default async function TemplatesPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const [industries, { data: templates }] = await Promise.all([
    listIndustries(workspace.id),
    supabase
      .from("message_templates")
      .select("id, name, stage, channel, body, industries(name)")
      .eq("workspace_id", workspace.id)
      .order("name"),
  ]);

  type Row = { id: string; name: string; stage: string; channel: string; body: string; industries: { name: string } | { name: string }[] | null };
  const rows = (templates ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Templates de mensagem</h1>
        <p className="text-sm text-muted-foreground">Catálogo por nicho, etapa e canal. Use {"{variavel}"} para personalização.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo template</CardTitle>
        </CardHeader>
        <CardContent>
          <NewTemplateForm industries={industries} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((t) => {
          const industry = Array.isArray(t.industries) ? t.industries[0] : t.industries;
          return (
            <Card key={t.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <div className="flex gap-1">
                    <Badge variant="outline">{t.channel}</Badge>
                    <Badge variant="outline">{t.stage}</Badge>
                  </div>
                </div>
                {industry && <p className="text-xs text-muted-foreground">{industry.name}</p>}
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
