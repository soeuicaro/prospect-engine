"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/shared/native-select";
import { discoverOsmAction, importOsmPlacesAction } from "@/lib/actions/discovery";
import type { OsmPlace } from "@/lib/providers/osm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DiscoveryForm({
  categories,
  industries,
  defaultCity,
  defaultState,
}: {
  categories: { value: string; label: string; query: string }[];
  industries: { id: string; name: string }[];
  defaultCity: string | null;
  defaultState: string | null;
}) {
  const [city, setCity] = useState(defaultCity ?? "");
  const [state, setState] = useState(defaultState ?? "");
  const [category, setCategory] = useState(categories[0]?.query ?? "");
  const [industryId, setIndustryId] = useState("");
  const [places, setPlaces] = useState<OsmPlace[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function search() {
    startTransition(async () => {
      const res = await discoverOsmAction(city, state, category);
      if (res.error) {
        toast.error(res.error);
        setPlaces(null);
      } else {
        setPlaces(res.places ?? []);
        setSelected(new Set());
        toast.success(`${res.places?.length ?? 0} empresa(s) encontrada(s).`);
      }
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function importSelected() {
    if (!places) return;
    const chosen = places.filter((p) => selected.has(p.osmId));
    startTransition(async () => {
      const res = await importOsmPlacesAction(chosen, city, state, industryId || null);
      if (res.error) toast.error(res.error);
      else toast.success(`${res.created} empresa(s) importada(s), ${res.skipped} já existiam.`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Cidade</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sobral" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">UF</label>
          <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} placeholder="CE" className="w-20" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Categoria</label>
          <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
            {categories.map((c) => (
              <option key={c.value} value={c.query}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Nicho (para importar)</label>
          <NativeSelect value={industryId} onChange={(e) => setIndustryId(e.target.value)} className="w-48">
            <option value="">Sem nicho</option>
            {industries.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button onClick={search} disabled={pending}>
          {pending ? "Buscando..." : "Buscar"}
        </Button>
      </div>

      {places && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{places.length} resultado(s)</p>
            <Button size="sm" disabled={pending || selected.size === 0} onClick={importSelected}>
              Importar {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Nome</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Website</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {places.map((p) => (
                  <TableRow key={p.osmId}>
                    <TableCell>
                      <Checkbox checked={selected.has(p.osmId)} onCheckedChange={() => toggle(p.osmId)} />
                    </TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[p.street, p.houseNumber].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.phone ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.website ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
