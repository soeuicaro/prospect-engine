"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshLeadScoreAction } from "@/lib/actions/companies";

export function RefreshScoreButton({ companyId }: { companyId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await refreshLeadScoreAction(companyId);
          if (res.error) toast.error(res.error);
          else toast.success("Score recalculado.");
        })
      }
    >
      <RefreshCw className={`mr-2 h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      Refresh Lead
    </Button>
  );
}
