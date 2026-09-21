"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildCampaignAudienceAction, activateCampaignAction } from "@/lib/actions/campaigns";

export function CampaignActions({
  campaignId,
  status,
  hasAudience,
}: {
  campaignId: string;
  status: string;
  hasAudience: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await buildCampaignAudienceAction(campaignId);
            if (res.error) toast.error(res.error);
            else toast.success("Audiência montada.");
          })
        }
      >
        Montar audiência
      </Button>
      <Button
        disabled={pending || status === "ACTIVE" || !hasAudience}
        onClick={() =>
          startTransition(async () => {
            const res = await activateCampaignAction(campaignId);
            if (res.error) toast.error(res.error);
            else toast.success("Campanha ativada.");
          })
        }
      >
        {status === "ACTIVE" ? "Campanha ativa" : "Executar campanha"}
      </Button>
    </div>
  );
}
