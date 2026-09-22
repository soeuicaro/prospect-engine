"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildGoogleMapsLinks,
  MAPS_VALIDATION_LABELS,
  type MapsInput,
  type MapsValidationStatus,
} from "@/lib/domain/maps";
import { setMapsValidationAction } from "@/lib/actions/companies";
import { formatDistanceToNow } from "@/lib/utils-date";

const STATUS_STYLE: Record<MapsValidationStatus, string> = {
  NOT_VALIDATED: "border-dashed text-muted-foreground",
  FOUND: "border-emerald-300 text-emerald-700",
  NOT_FOUND: "border-zinc-300 text-zinc-600",
  WRONG_RESULT: "border-red-300 text-red-700",
  DUPLICATE: "border-violet-300 text-violet-700",
  NEEDS_REVIEW: "border-amber-300 text-amber-700",
};

const OPTIONS: MapsValidationStatus[] = ["FOUND", "NOT_FOUND", "WRONG_RESULT", "DUPLICATE", "NEEDS_REVIEW"];

/**
 * "Abrir no Google Maps" + "Validar no Google Maps" (§5-7). The user opens
 * Maps, checks, and records what they saw. Nothing from Maps is stored.
 */
export function MapsActions({
  companyId,
  company,
  validationStatus,
  validatedAt,
  note,
}: {
  companyId: string;
  company: MapsInput;
  validationStatus: string;
  validatedAt?: string | null;
  note?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [opened, setOpened] = useState(false);
  const links = buildGoogleMapsLinks(company);
  const status = (validationStatus in MAPS_VALIDATION_LABELS ? validationStatus : "NOT_VALIDATED") as MapsValidationStatus;

  function record(next: MapsValidationStatus) {
    startTransition(async () => {
      const res = await setMapsValidationAction(companyId, next, draftNote);
      if (res.error) toast.error(res.error);
      else toast.success(`Validação registrada: ${MAPS_VALIDATION_LABELS[next]}`);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={links.searchUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir no Google Maps
          </a>
        </Button>
        {links.pinUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a href={links.pinUrl} target="_blank" rel="noopener noreferrer">
              <Navigation className="mr-1 h-3.5 w-3.5" /> Ver coordenadas
            </a>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={opened && status === "NOT_VALIDATED" ? "default" : "outline"} size="sm" disabled={pending}>
              <MapPin className="mr-1 h-3.5 w-3.5" /> Validar no Google Maps
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>O que você encontrou no Maps?</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {OPTIONS.map((o) => (
              <DropdownMenuItem key={o} onClick={() => record(o)}>
                {o === status && <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                {MAPS_VALIDATION_LABELS[o]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => record("NOT_VALIDATED")}>Limpar validação</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Badge variant="outline" className={STATUS_STYLE[status]}>
          {MAPS_VALIDATION_LABELS[status]}
        </Badge>
        {validatedAt && <span className="text-xs text-muted-foreground">{formatDistanceToNow(validatedAt)}</span>}
      </div>
      <Textarea
        value={draftNote}
        onChange={(e) => setDraftNote(e.target.value)}
        placeholder="Nota da validação (opcional) — ex.: endereço mudou, fechado, nome diferente no Maps"
        className="min-h-14 text-xs"
        maxLength={500}
      />
      <p className="text-[11px] text-muted-foreground">
        Consulta Maps: <span className="font-mono">{links.query || "—"}</span>. Apenas o status e a sua nota são salvos — nenhum conteúdo do Google Maps.
      </p>
    </div>
  );
}
