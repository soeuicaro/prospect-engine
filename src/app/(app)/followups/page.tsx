import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { CalendarClock } from "lucide-react";
import { FollowupQueueItem } from "@/components/followups/followup-queue-item";

export default async function FollowupsPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  // eslint-disable-next-line react-hooks/purity -- server-rendered on every request, no hydration reuse
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const { data: followups } = await supabase
    .from("followups")
    .select("id, follow_up_at, note, company_id, companies(trade_name, legal_name)")
    .eq("workspace_id", workspace.id)
    .eq("status", "PENDING")
    .lte("follow_up_at", in7Days.toISOString())
    .order("follow_up_at");

  type Row = {
    id: string;
    follow_up_at: string;
    note: string | null;
    company_id: string;
    companies: { trade_name: string | null; legal_name: string | null } | { trade_name: string | null; legal_name: string | null }[] | null;
  };

  const rows = (followups ?? []) as Row[];
  const overdue = rows.filter((r) => new Date(r.follow_up_at) < startOfDay);
  const today = rows.filter((r) => new Date(r.follow_up_at) >= startOfDay && new Date(r.follow_up_at) <= endOfToday);
  const upcoming = rows.filter((r) => new Date(r.follow_up_at) > endOfToday);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">Atrasados, hoje e próximos 7 dias.</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhum follow-up agendado"
          description="Follow-ups são criados automaticamente ao marcar um contato como enviado, ou manualmente na página do lead."
          actionLabel="Ver empresas"
          actionHref="/companies"
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <FollowupColumn title="Atrasados" rows={overdue} tone="destructive" />
          <FollowupColumn title="Hoje" rows={today} tone="default" />
          <FollowupColumn title="Próximos 7 dias" rows={upcoming} tone="muted" />
        </div>
      )}
    </div>
  );
}

function FollowupColumn({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: {
    id: string;
    follow_up_at: string;
    note: string | null;
    company_id: string;
    companies: { trade_name: string | null; legal_name: string | null } | { trade_name: string | null; legal_name: string | null }[] | null;
  }[];
  tone: "destructive" | "default" | "muted";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className={tone === "destructive" ? "text-destructive" : ""}>
          {title} ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nada por aqui.</p>}
        {rows.map((r) => {
          const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
          return (
            <FollowupQueueItem
              key={r.id}
              id={r.id}
              followUpAt={r.follow_up_at}
              note={r.note}
              companyName={company?.trade_name || company?.legal_name || "Empresa"}
              companyHref={`/companies/${r.company_id}`}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
