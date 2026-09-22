"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildGoogleMapsLinks } from "@/lib/domain/maps";
import { ContactActions } from "@/components/shared/contact-actions";

const STRATEGY_LABEL: Record<string, string> = {
  name_address: "nome + endereço + cidade/UF",
  name_city: "nome + cidade/UF",
  name_only: "somente nome",
  address_only: "somente endereço",
  coordinates: "coordenadas",
  city_only: "somente cidade",
};

export function MapsTestPanel() {
  const [name, setName] = useState("Restaurante Aragão");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("Sobral");
  const [state, setState] = useState("CE");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  const links = useMemo(
    () =>
      buildGoogleMapsLinks({
        trade_name: name,
        street,
        street_number: number,
        neighborhood,
        city,
        state,
        latitude: lat ? Number(lat) : null,
        longitude: lon ? Number(lon) : null,
      }),
    [name, street, number, neighborhood, city, state, lat, lon]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da empresa</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {[
            ["Nome", name, setName],
            ["Logradouro", street, setStreet],
            ["Número", number, setNumber],
            ["Bairro", neighborhood, setNeighborhood],
            ["Cidade", city, setCity],
            ["UF", state, setState],
            ["Latitude", lat, setLat],
            ["Longitude", lon, setLon],
          ].map(([label, value, set]) => (
            <div key={label as string}>
              <label className="text-xs text-muted-foreground">{label as string}</label>
              <Input value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">URL gerada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <p>
            Estratégia: <strong>{STRATEGY_LABEL[links.strategy]}</strong>
          </p>
          <p>
            Query: <span className="font-mono">{links.query || "—"}</span>
          </p>
          <p>
            Query codificada: <span className="font-mono break-all">{encodeURIComponent(links.query)}</span>
          </p>
          <p className="break-all">
            Pesquisa: <span className="font-mono">{links.searchUrl}</span>
          </p>
          {links.pinUrl && (
            <p className="break-all">
              Coordenadas: <span className="font-mono">{links.pinUrl}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" asChild>
              <a href={links.searchUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" /> Abrir pesquisa (nova aba)
              </a>
            </Button>
            {links.pinUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={links.pinUrl} target="_blank" rel="noopener noreferrer">
                  Abrir coordenadas
                </a>
              </Button>
            )}
          </div>
          <p className="pt-2 text-muted-foreground">Barra de ações como aparece nas tabelas e cards:</p>
          <ContactActions
            target={{ name, street, houseNumber: number, neighborhood, city, state, lat: lat ? Number(lat) : null, lon: lon ? Number(lon) : null }}
          />
          <p className="pt-2 text-muted-foreground">
            Formato oficial Maps URLs (`/maps/search/?api=1&query=`), sem chave de API, aberto pelo usuário em nova aba. Nada é consultado
            automaticamente e nenhum conteúdo do Google Maps é armazenado.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
