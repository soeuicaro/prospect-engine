import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImportWizard } from "@/components/imports/import-wizard";
import { formatDateTimeBR } from "@/lib/utils-date";

export default async function ImportsPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: imports } = await supabase
    .from("imports")
    .select("id, file_name, status, total_rows, processed_rows, created_count, duplicate_count, error_count, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar empresas</h1>
        <p className="text-sm text-muted-foreground">
          CSV com cabeçalho na primeira linha. Duplicados (por CNPJ, domínio, telefone ou nome+cidade) são
          detectados automaticamente e ignorados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo import (CSV)</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportWizard />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de imports</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {(imports ?? []).map((imp) => (
            <div key={imp.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium">{imp.file_name}</p>
                <p className="text-xs text-muted-foreground">{formatDateTimeBR(imp.created_at)}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{imp.created_count} criadas</span>
                <span>{imp.duplicate_count} duplicadas</span>
                <span>{imp.error_count} erros</span>
                <Badge variant="outline">{imp.status}</Badge>
              </div>
            </div>
          ))}
          {(!imports || imports.length === 0) && (
            <p className="py-4 text-sm text-muted-foreground">Nenhum import realizado ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
