"use client";

import { useState } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { testSourceAction } from "@/lib/actions/discovery";
import type { SourceTestResult } from "@/lib/discovery/diagnostics";
import type { SourceKey } from "@/lib/discovery/types";
import { RunStatusBadge } from "@/components/discovery/badges";

const OSM_SOURCES: { key: SourceKey; label: string }[] = [
  { key: "osm_overpass", label: "Overpass (3 mirrors)" },
  { key: "osm_nominatim", label: "Nominatim" },
  { key: "osm_photon", label: "Photon" },
];

export function OsmTestPanel({ defaultCity, defaultState }: { defaultCity: string; defaultState: string }) {
  const [city, setCity] = useState(defaultCity);
  const [state, setState] = useState(defaultState);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("2");
  const [query, setQuery] = useState("amenity=restaurant");
  const [running, setRunning] = useState<SourceKey | "all" | null>(null);
  const [results, setResults] = useState<Partial<Record<SourceKey, SourceTestResult>>>({});

  async function run(keys: SourceKey[]) {
    setRunning(keys.length > 1 ? "all" : keys[0]);
    const input = {
      city,
      state,
      lat: lat ? Number(lat) : null,
      lon: lon ? Number(lon) : null,
      radiusKm: radius ? Number(radius) : null,
      query,
    };
    try {
      const out = await Promise.all(keys.map((k) => testSourceAction(k, input)));
      setResults((prev) => ({ ...prev, ...Object.fromEntries(out.map((r) => [r.source, r])) }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <L label="Cidade">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </L>
          <L label="UF">
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </L>
          <L label="Lat (opcional)">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-3.6883" />
          </L>
          <L label="Lon (opcional)">
            <Input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-40.3497" />
          </L>
          <L label="Raio km (com lat/lon)">
            <Input value={radius} onChange={(e) => setRadius(e.target.value)} />
          </L>
          <L label="Query (tag OSM ou palavra)">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </L>
          <div className="flex flex-wrap gap-2 md:col-span-6">
            <Button onClick={() => void run(OSM_SOURCES.map((s) => s.key))} disabled={running !== null}>
              {running === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />} TEST CONNECTION (todas)
            </Button>
            {OSM_SOURCES.map((s) => (
              <Button key={s.key} variant="outline" onClick={() => void run([s.key])} disabled={running !== null}>
                {running === s.key && <Loader2 className="size-3.5 animate-spin" />} {s.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground md:col-span-6">
            Sem lat/lon: Overpass usa o limite municipal (área OSM) e cai para bbox do geocoder; Nominatim/Photon usam o bbox da cidade. As
            mesmas rotinas de retry, timeout, circuit breaker e throttle das buscas reais são usadas aqui; o resultado atualiza a saúde da fonte.
          </p>
        </CardContent>
      </Card>

      {OSM_SOURCES.map(({ key, label }) => {
        const r = results[key];
        if (!r) return null;
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                {r.ok ? "✅" : "❌"} {label} {r.status !== "SKIPPED" && <RunStatusBadge status={r.status} />}
                <span className="text-xs font-normal text-muted-foreground">
                  {(r.latencyMs / 1000).toFixed(2)}s · {r.count} resultado(s)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {r.error && <p className={r.ok ? "text-amber-700" : "text-red-700"}>{r.error}</p>}
              {r.sample.length > 0 && <p>Amostra: {r.sample.join(" · ")}</p>}
              <p>Endpoints: {r.endpoints.join(", ") || "—"}</p>
              {r.queries.map((q, i) => (
                <pre key={i} className="overflow-x-auto rounded bg-muted p-2 text-[11px]">
                  {q}
                </pre>
              ))}
              <table className="w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th>Endpoint</th>
                    <th>HTTP</th>
                    <th>Latência</th>
                    <th>Tentativa</th>
                    <th>Erro</th>
                    <th>Resultados</th>
                  </tr>
                </thead>
                <tbody>
                  {r.logs.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td>{l.endpoint}</td>
                      <td>{l.httpStatus ?? "—"}</td>
                      <td>{l.latencyMs}ms</td>
                      <td>
                        {l.attempt}/{l.maxAttempts}
                      </td>
                      <td className="text-red-700">{l.errorKind ? `${l.errorKind}: ${l.errorMessage}` : ""}</td>
                      <td>{l.resultsCount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
