"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveConflictAction } from "@/lib/actions/discovery";
import type { Company } from "@/types/database";

const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  legalName: "Razão social",
  cnpj: "CNPJ",
  category: "Categoria",
  street: "Logradouro",
  houseNumber: "Número",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "UF",
  postcode: "CEP",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  website: "Website",
  coordinates: "Coordenadas",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

const SOURCE_LABEL: Record<string, string> = {
  local_db: "Banco local",
  osm_overpass: "OSM (Overpass)",
  osm_nominatim: "OSM (Nominatim)",
  osm_photon: "OSM (Photon)",
  cnpj_brasilapi: "CNPJ (Receita/BrasilAPI)",
  website_discovery: "Site oficial",
};

/** Field-level provenance (§15, §104) + conflict resolution (§16). */
export function DataProvenance({
  companyId,
  provenance,
  conflicts,
}: {
  companyId: string;
  provenance: Company["field_provenance"];
  conflicts: Company["data_conflicts"];
}) {
  const [pending, startTransition] = useTransition();
  const entries = Object.entries(provenance ?? {});

  function choose(field: string, value: string) {
    startTransition(async () => {
      const res = await resolveConflictAction(companyId, field, value);
      if (res.error) toast.error(res.error);
      else toast.success("Valor escolhido e registrado.");
    });
  }

  return (
    <div className="space-y-3 text-xs">
      {(conflicts ?? []).length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/30">
          <p className="font-medium text-amber-800 dark:text-amber-200">Existem dados conflitantes — escolha o correto:</p>
          {(conflicts ?? []).map((c) => (
            <div key={c.field} className="space-y-1">
              <p className="font-medium">{FIELD_LABEL[c.field] ?? c.field}</p>
              <div className="flex flex-wrap gap-1">
                {[c.chosen, ...c.alternatives].map((v, i) => (
                  <Button key={`${v.value}-${i}`} size="xs" variant={i === 0 ? "default" : "outline"} disabled={pending} onClick={() => choose(c.field, v.value)}>
                    {v.value} · {SOURCE_LABEL[v.source] ?? v.source}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {entries.length === 0 ? (
        <p className="text-muted-foreground">Sem procedência por campo registrada (empresa criada antes do Discovery Engine 2.0).</p>
      ) : (
        <div className="space-y-0.5">
          {entries.map(([field, v]) => (
            <div key={field} className="flex justify-between gap-2 border-b py-0.5 last:border-0">
              <span className="text-muted-foreground">{FIELD_LABEL[field] ?? field}</span>
              <span className="truncate text-right" title={`${v.value} — coletado em ${new Date(v.collected_at).toLocaleString("pt-BR")}`}>
                {SOURCE_LABEL[v.source] ?? v.source} · {v.confidence}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
