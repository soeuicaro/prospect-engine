import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImportWizard } from "@/components/imports/import-wizard";
import { EnrichStoredButton } from "@/components/imports/enrich-stored-button";
import { ENRICH_TAG } from "@/lib/discovery/batch-enrich";
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

  const { count: pendingEnrichment } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .not("tags", "cs", `{${ENRICH_TAG}}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar empresas</h1>
        <p className="text-sm text-muted-foreground">
          CSV com cabeçalho na primeira linha. Duplicados (por CNPJ, domínio, telefone ou nome+cidade) são
          detectados automaticamente e ignorados.
        </p>
      </div>

      <Card className="border-sky-300">
        <CardHeader>
          <CardTitle className="text-base">Base oficial CNPJ (Receita Federal) — máximo de empresas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            A maior cobertura vem dos Dados Abertos do CNPJ: todas as empresas ativas do município, com telefone, e-mail,
            endereço, CNAE, porte e sócios. O sincronizador baixa direto da Receita em streaming, filtra e grava aqui sem
            duplicar nem sobrescrever o que você já editou. Rode no terminal, na pasta do projeto:
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{`# todas as empresas ativas da cidade (recomendado)
npm run cnpj:sync -- --uf ${workspace.state ?? "CE"} --municipio "${workspace.city ?? "Sobral"}" --all-cnaes --socios --simples --supabase

# só um nicho (mais rápido de gravar, mesmo download)
npm run cnpj:sync -- --uf ${workspace.state ?? "CE"} --municipio "${workspace.city ?? "Sobral"}" --preset restaurante --supabase

# teste rápido (1/10 dos arquivos, não grava)
npm run cnpj:sync -- --uf ${workspace.state ?? "CE"} --municipio "${workspace.city ?? "Sobral"}" --all-cnaes --sample --dry-run`}</pre>
          <p className="text-xs text-muted-foreground">
            Download de ~6–8 GB em streaming (nada fica em disco), ~45–60 min dependendo da banda da Receita; retoma
            sozinho se a conexão cair. Atualização mensal: rode de novo quando sair um novo mês. Detalhes em CNPJ_IMPORT.md.
          </p>
          <div className="border-t pt-3">
            <p className="mb-2 font-medium">Depois do import: enriquecer a base</p>
            <EnrichStoredButton pending={pendingEnrichment ?? 0} />
          </div>
        </CardContent>
      </Card>

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
