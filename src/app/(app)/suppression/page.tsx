import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ShieldOff } from "lucide-react";
import Link from "next/link";
import { formatDateTimeBR } from "@/lib/utils-date";

const REASON_LABELS: Record<string, string> = {
  opt_out: "Opt-out",
  nao_quer_contato: "Não quer contato",
  numero_invalido: "Número inválido",
  email_invalido: "E-mail inválido",
  reclamacao: "Reclamação",
  bloqueado: "Bloqueado",
  duplicado: "Duplicado",
  juridico: "Jurídico",
  manual: "Manual",
};

export default async function SuppressionPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("suppression_list")
    .select("id, channel, reason, created_at, value, companies(id, trade_name, legal_name)")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    channel: string | null;
    reason: string;
    created_at: string;
    value: string | null;
    companies: { id: string; trade_name: string | null; legal_name: string | null } | { id: string; trade_name: string | null; legal_name: string | null }[] | null;
  };
  const items = (rows ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Suppression List</h1>
        <p className="text-sm text-muted-foreground">
          Empresas/contatos que nunca devem entrar automaticamente em novas campanhas.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={ShieldOff} title="Nenhuma supressão registrada" description="Bom sinal — ninguém pediu para não ser contatado ainda." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{items.length} registro(s)</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {items.map((r) => {
              const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
              return (
                <div key={r.id} className="flex items-center justify-between py-2">
                  <div>
                    {company ? (
                      <Link href={`/companies/${company.id}`} className="text-sm font-medium hover:underline">
                        {company.trade_name || company.legal_name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{r.value ?? "Registro manual"}</span>
                    )}
                    <p className="text-xs text-muted-foreground">{formatDateTimeBR(r.created_at)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{r.channel ?? "all"}</Badge>
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
