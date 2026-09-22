"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ScoreBadge, OpportunityBadge } from "@/components/shared/badges";
import type { CompanyListRow } from "@/lib/queries/companies";
import { bulkChangeStageAction, bulkSuppressAction } from "@/lib/actions/bulk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { ContactActions } from "@/components/shared/contact-actions";
import { CompletenessBadge } from "@/components/discovery/badges";
import { computeCompleteness, completenessLabel } from "@/lib/discovery/completeness";
import { Badge } from "@/components/ui/badge";

const SOURCE_TYPE_LABEL: Record<string, string> = {
  CNPJ: "CNPJ",
  OSM: "OSM",
  WEBSITE: "WEB",
  MANUAL: "Manual",
  IMPORT_CSV: "CSV",
  IMPORT_XLSX: "XLSX",
  MAPS_VALIDATION: "Maps",
  OTHER: "Outra",
};

function rowCompleteness(row: CompanyListRow) {
  const score = computeCompleteness({
    cnpj: row.cnpj,
    name: row.trade_name || row.legal_name || "",
    street: row.street,
    city: row.city,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    website: row.website,
    socials: row.socials,
    hasDecisionMaker: row.has_decision_maker,
  });
  return { score, label: completenessLabel(score) };
}

interface Stage {
  id: string;
  label: string;
}

export function CompaniesTable({ rows, stages }: { rows: CompanyListRow[]; stages: Stage[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function handleBulkStage(stageId: string) {
    startTransition(async () => {
      const res = await bulkChangeStageAction(Array.from(selected), stageId);
      if (res.error) toast.error(res.error);
      else {
        toast.success(`${selected.size} empresa(s) movida(s) de etapa.`);
        setSelected(new Set());
      }
    });
  }

  function handleBulkSuppress() {
    startTransition(async () => {
      const res = await bulkSuppressAction(Array.from(selected));
      if (res.error) toast.error(res.error);
      else {
        toast.success(`${selected.size} empresa(s) suprimida(s).`);
        setSelected(new Set());
      }
    });
  }

  return (
    <div className="space-y-2">
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selecionada(s)</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={pending}>
                Mover para etapa
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => handleBulkStage(s.id)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" disabled={pending} onClick={handleBulkSuppress}>
            Suprimir (não contatar)
          </Button>
        </div>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selected.size > 0 && selected.size === rows.length}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Nicho</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Fontes</TableHead>
              <TableHead>Completude</TableHead>
              <TableHead>Ações</TableHead>
              <TableHead>Próxima ação</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer">
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggle(row.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={row.prospect_score} />
                    <OpportunityBadge level={row.opportunity_level} />
                  </div>
                </TableCell>
                <TableCell>
                  <Link href={`/companies/${row.id}`} className="font-medium hover:underline">
                    {row.trade_name || row.legal_name || "Sem nome"}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.industry_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {[row.city, row.state].filter(Boolean).join("/")}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.stage_label ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.whatsapp || row.phone || row.website || "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.source_types.map((t) => (
                      <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px]">
                        {SOURCE_TYPE_LABEL[t] ?? t}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {(() => {
                    const c = rowCompleteness(row);
                    return <CompletenessBadge label={c.label} score={c.score} />;
                  })()}
                </TableCell>
                <TableCell>
                  <ContactActions
                    compact
                    target={{
                      name: row.trade_name,
                      legalName: row.legal_name,
                      street: row.street,
                      houseNumber: row.street_number,
                      neighborhood: row.neighborhood,
                      city: row.city,
                      state: row.state,
                      lat: row.latitude,
                      lon: row.longitude,
                      website: row.website,
                      phone: row.phone,
                      whatsapp: row.whatsapp,
                      email: row.email,
                      socials: row.socials,
                    }}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">{row.next_best_action ?? "—"}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/companies/${row.id}`}>Ver detalhes</Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
