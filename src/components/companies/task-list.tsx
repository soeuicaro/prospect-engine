"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { completeTaskAction } from "@/lib/actions/companies";
import { formatDateTimeBR } from "@/lib/utils-date";
import type { Task } from "@/types/database";

export function TaskList({ tasks }: { tasks: Task[] }) {
  const [pending, startTransition] = useTransition();

  const open = tasks.filter((t) => t.status === "OPEN");

  if (open.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma tarefa pendente.</p>;
  }

  return (
    <div className="space-y-2">
      {open.map((t) => (
        <div key={t.id} className="flex items-start gap-2">
          <Checkbox
            disabled={pending}
            onCheckedChange={() =>
              startTransition(async () => {
                const res = await completeTaskAction(t.id);
                if (res.error) toast.error(res.error);
              })
            }
          />
          <div>
            <p className="text-sm">{t.title}</p>
            {t.due_at && <p className="text-xs text-muted-foreground">{formatDateTimeBR(t.due_at)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
