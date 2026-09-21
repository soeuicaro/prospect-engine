"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeFollowupAction } from "@/lib/actions/companies";
import { formatDateTimeBR } from "@/lib/utils-date";

export function FollowupQueueItem({
  id,
  followUpAt,
  note,
  companyName,
  companyHref,
}: {
  id: string;
  followUpAt: string;
  note: string | null;
  companyName: string;
  companyHref: string;
}) {
  const [pending, startTransition] = useTransition();

  function act(status: Parameters<typeof completeFollowupAction>[1]) {
    startTransition(async () => {
      const res = await completeFollowupAction(id, status);
      if (res.error) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-1 border-b pb-2 last:border-0">
      <Link href={companyHref} className="text-sm font-medium hover:underline">
        {companyName}
      </Link>
      <p className="text-xs text-muted-foreground">{formatDateTimeBR(followUpAt)}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex gap-1 pt-1">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("DONE")}>
          Concluir
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("NO_RESPONSE")}>
          Sem resposta
        </Button>
      </div>
    </div>
  );
}
