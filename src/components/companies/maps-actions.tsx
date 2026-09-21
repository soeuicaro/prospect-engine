"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, MapPin, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildGoogleMapsSearchUrl } from "@/lib/domain/maps";
import { validateMapsAction } from "@/lib/actions/companies";

export function MapsActions({
  companyId,
  company,
  validationStatus,
}: {
  companyId: string;
  company: {
    trade_name: string | null;
    legal_name: string | null;
    street: string | null;
    street_number: string | null;
    city: string | null;
    state: string | null;
  };
  validationStatus: string;
}) {
  const [pending, startTransition] = useTransition();
  const url = buildGoogleMapsSearchUrl(company);

  function validate(discrepancy: boolean) {
    startTransition(async () => {
      const res = await validateMapsAction(companyId, discrepancy);
      if (res.error) toast.error(res.error);
      else toast.success(discrepancy ? "Discrepância registrada." : "Validado no Maps.");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir no Google Maps
        </a>
      </Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => validate(false)}>
        <MapPin className="mr-2 h-3.5 w-3.5" /> Validar no Maps
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => validate(true)}>
        <AlertTriangle className="mr-2 h-3.5 w-3.5" /> Reportar discrepância
      </Button>
      <span className="text-xs text-muted-foreground">Status: {statusLabel(validationStatus)}</span>
    </div>
  );
}

function statusLabel(status: string) {
  return (
    { NOT_VALIDATED: "Não validado", VALIDATED_BY_USER: "Validado pelo usuário", DISCREPANCY_FOUND: "Discrepância encontrada" }[
      status
    ] ?? status
  );
}
