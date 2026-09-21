"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { toggleFeatureFlagAction } from "@/lib/actions/settings";

const FLAG_LABELS: Record<string, string> = {
  MAPS_LINKS: "Links de validação no Google Maps",
  WEB_ANALYSIS: "Analisador de website",
  OSM_DISCOVERY: "Discovery via OpenStreetMap",
  CNPJ_IMPORT: "Importação de dados de CNPJ",
  EMAIL_ASSIST: "Envio assistido de e-mail",
  WHATSAPP_ASSIST: "Envio assistido de WhatsApp",
  AI_DISABLED: "IA desativada (núcleo funciona sem IA)",
  LOCAL_AI: "IA local (futuro)",
  ADVANCED_AUTOMATION: "Automação avançada (futuro)",
};

export function FeatureFlagsPanel({ flags }: { flags: Record<string, boolean> }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        COST_MODE = FREE_ONLY por padrão. Nenhuma integração paga é ativada automaticamente.
      </p>
      {Object.entries(FLAG_LABELS).map(([key, label]) => (
        <div key={key} className="flex items-center justify-between border-b pb-2 last:border-0">
          <span className="text-sm">{label}</span>
          <Switch
            checked={Boolean(flags[key])}
            disabled={pending}
            onCheckedChange={(checked) =>
              startTransition(async () => {
                const res = await toggleFeatureFlagAction(key, checked);
                if (res.error) toast.error(res.error);
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
