"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { completeTaskAction } from "@/lib/actions/companies";
import { formatDateTimeBR } from "@/lib/utils-date";

interface TaskRow {
  id: string;
  title: string;
  due_at: string | null;
  priority: string;
  company_id: string | null;
  companies: { trade_name: string | null; legal_name: string | null } | { trade_name: string | null; legal_name: string | null }[] | null;
}

export function TaskQueueItem({ task }: { task: TaskRow }) {
  const [pending, startTransition] = useTransition();
  const company = Array.isArray(task.companies) ? task.companies[0] : task.companies;

  return (
    <div className="flex items-start gap-2 border-b pb-2 last:border-0">
      <Checkbox
        disabled={pending}
        onCheckedChange={() =>
          startTransition(async () => {
            const res = await completeTaskAction(task.id);
            if (res.error) toast.error(res.error);
          })
        }
      />
      <div className="flex-1">
        <p className="text-sm">{task.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {task.due_at && <span>{formatDateTimeBR(task.due_at)}</span>}
          <Badge variant="outline">{task.priority}</Badge>
          {task.company_id && company && (
            <Link href={`/companies/${task.company_id}`} className="underline">
              {company.trade_name || company.legal_name}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
