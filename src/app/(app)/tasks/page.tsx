import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ListChecks } from "lucide-react";
import { TaskForm } from "@/components/companies/task-form";
import { TaskQueueItem } from "@/components/tasks/task-queue-item";

export default async function TasksPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, description, due_at, priority, company_id, companies(trade_name, legal_name)")
    .eq("workspace_id", workspace.id)
    .eq("status", "OPEN")
    .order("due_at", { nullsFirst: false });

  type Row = {
    id: string;
    title: string;
    description: string | null;
    due_at: string | null;
    priority: string;
    company_id: string | null;
    companies: { trade_name: string | null; legal_name: string | null } | { trade_name: string | null; legal_name: string | null }[] | null;
  };
  const rows = (tasks ?? []) as Row[];
  // eslint-disable-next-line react-hooks/purity -- server-rendered on every request, no hydration reuse
  const now = Date.now();
  const overdue = rows.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
  const upcoming = rows.filter((t) => !t.due_at || new Date(t.due_at).getTime() >= now);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tarefas</h1>
        <p className="text-sm text-muted-foreground">Ligações, follow-ups, pesquisas e preparação de propostas.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova tarefa</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskForm companyId="" />
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nenhuma tarefa aberta" description="Crie uma tarefa acima para começar." />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-destructive">Vencidas ({overdue.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {overdue.map((t) => (
                <TaskQueueItem key={t.id} task={t} />
              ))}
              {overdue.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma tarefa vencida.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Próximas ({upcoming.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcoming.map((t) => (
                <TaskQueueItem key={t.id} task={t} />
              ))}
              {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nada por aqui.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
