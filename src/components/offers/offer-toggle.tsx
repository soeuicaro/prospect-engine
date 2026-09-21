"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toggleOfferActiveAction } from "@/lib/actions/catalog";

export function OfferToggle({ offerId, active }: { offerId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={active}
        disabled={pending}
        onCheckedChange={(checked) =>
          startTransition(async () => {
            const res = await toggleOfferActiveAction(offerId, checked);
            if (res.error) toast.error(res.error);
          })
        }
      />
      <span className="text-xs text-muted-foreground">{active ? "Ativa" : "Inativa"}</span>
    </div>
  );
}
