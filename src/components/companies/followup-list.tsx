"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeFollowupAction } from "@/lib/actions/companies";
import { formatDateTimeBR } from "@/lib/utils-date";
import type { Followup } from "@/types/database";

export function FollowupList({ followups }: { followups: Followup[] }) {
  const [pending, startTransition] = useTransition();
  const pendingFollowups = followups.filter((f) => f.status === "PENDING");

  if (pendingFollowups.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum follow-up agendado.</p>;
  }

  function act(id: string, status: Parameters<typeof completeFollowupAction>[1]) {
    startTransition(async () => {
      const res = await completeFollowupAction(id, status);
      if (res.error) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-2">
      {pendingFollowups.map((f) => (
        <div key={f.id} className="space-y-1 border-b pb-2 last:border-0">
          <p className="text-sm font-medium">{formatDateTimeBR(f.follow_up_at)}</p>
          {f.note && <p className="text-xs text-muted-foreground">{f.note}</p>}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(f.id, "DONE")}>
              Concluir
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(f.id, "NO_RESPONSE")}>
              Sem resposta
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(f.id, "INTERESTED")}>
              Interessado
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() => act(f.id, "OPT_OUT")}
            >
              Opt-out
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
