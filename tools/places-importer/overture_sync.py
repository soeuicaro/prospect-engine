#!/usr/bin/env python3
"""
overture_sync.py — imports the business places of one or more cities from
Overture Maps Places into the app's `places_pois` table (Discovery source
"Overture Maps").

Overture Places is open data (CDLA-Permissive-2.0) aggregated from Meta
(Facebook business pages), Microsoft, Foursquare and AllThePlaces: name,
category, phones, websites, e-mails, social profiles, address and
coordinates. It is the closest free equivalent of a Google Maps listing —
no API key, no billing, no scraping. Reads GeoParquet straight from the
public S3 bucket with DuckDB, downloading only the row groups that overlap
the city (a mid-size city takes ~1-2 min).

    pip install duckdb
    python tools/places-importer/overture_sync.py --uf CE --municipio Sobral
    python tools/places-importer/overture_sync.py --uf CE --municipio Sobral --municipio Forquilha
    python tools/places-importer/overture_sync.py --uf CE --municipio Sobral --dry-run --output sobral.csv

Re-running is idempotent (upsert on the Overture id); a new release refreshes
the rows. The city boundary comes from Nominatim (OSM, usage policy: 1 req/s,
identified User-Agent) so places just outside the municipality are dropped.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cnpj-importer"))
from cnpj_sync import Supabase, chunks, log, title_city  # noqa: E402

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
USER_AGENT = "ProspectEngine-places-sync/1.0 (+local prospecting tool)"
UF_NAMES = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
    "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina",
    "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins",
}


def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def latest_release() -> str:
    xml = http_get(f"{BUCKET}/?list-type=2&prefix=release/&delimiter=/").decode()
    releases = sorted(re.findall(r"<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>", xml))
    if not releases:
        raise SystemExit("Não encontrei nenhuma release do Overture no bucket público.")
    return releases[-1]


def fold(text: str) -> str:
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().lower().strip()


def municipality_boundary(city: str, uf: str) -> dict:
    """GeoJSON polygon of the municipality (OSM boundary relation) via Nominatim."""
    q = urllib.parse.urlencode({"city": city, "state": UF_NAMES[uf], "country": "Brasil", "format": "jsonv2", "polygon_geojson": 1, "limit": 8, "addressdetails": 1})
    places = json.loads(http_get(f"https://nominatim.openstreetmap.org/search?{q}"))
    time.sleep(1.1)  # Nominatim policy: max 1 req/s
    candidates = [
        p for p in places
        if p.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon")
        and fold(p.get("address", {}).get("state", "")) == fold(UF_NAMES[uf])
    ]
    candidates.sort(key=lambda p: (p.get("osm_type") == "relation", p.get("addresstype") in ("municipality", "city", "town")), reverse=True)
    if not candidates:
        raise SystemExit(f"Limite municipal de {city}/{uf} não encontrado no OpenStreetMap.")
    return candidates[0]["geojson"]


def query_places(con, release: str, boundary: dict) -> list[dict]:
    src = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    coords = boundary["coordinates"] if boundary["type"] == "MultiPolygon" else [boundary["coordinates"]]
    xs = [pt[0] for poly in coords for ring in poly for pt in ring]
    ys = [pt[1] for poly in coords for ring in poly for pt in ring]
    geo = json.dumps(boundary).replace("'", "''")
    sql = f"""
      SELECT id,
             names."primary" AS name,
             categories."primary" AS category,
             list_distinct(list_filter(
               list_concat([categories."primary", basic_category, taxonomy."primary"], coalesce(categories.alternate, []), coalesce(taxonomy.hierarchy, [])),
               lambda x: x IS NOT NULL)) AS categories,
             confidence, operating_status,
             coalesce(phones, []) AS phones, coalesce(websites, []) AS websites,
             coalesce(emails, []) AS emails, coalesce(socials, []) AS socials,
             addresses[1].freeform AS street, addresses[1].postcode AS postcode,
             ST_Y(ST_Centroid(geometry)) AS latitude, ST_X(ST_Centroid(geometry)) AS longitude,
             list_distinct([s.dataset FOR s IN coalesce(sources, [])]) AS datasets
      FROM read_parquet('{src}', hive_partitioning = 1)
      WHERE bbox.xmin BETWEEN {min(xs)} AND {max(xs)}
        AND bbox.ymin BETWEEN {min(ys)} AND {max(ys)}
        AND ST_Within(geometry, ST_GeomFromGeoJSON('{geo}'))
        AND names."primary" IS NOT NULL
    """
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", required=True, help="UF, ex.: CE")
    p.add_argument("--municipio", action="append", required=True, help="Município (repetível)")
    p.add_argument("--release", help="Release do Overture (padrão: a mais recente)")
    p.add_argument("--include-closed", action="store_true", help="Manter locais marcados como fechados")
    p.add_argument("--dry-run", action="store_true", help="Não grava no banco")
    p.add_argument("--output", help="Também gravar CSV")
    a = p.parse_args()

    uf = a.uf.strip().upper()
    if uf not in UF_NAMES:
        raise SystemExit(f"UF inválida: {a.uf}")
    try:
        import duckdb
    except ImportError:
        raise SystemExit("DuckDB não instalado. Rode: pip install duckdb")

    release = a.release or latest_release()
    log(f"Overture Maps Places — release {release}")
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")

    sb = None if a.dry_run else Supabase()
    wid = None
    if sb:
        ws = sb.req("GET", "workspaces?select=id,name&limit=1") or []
        if not ws:
            raise SystemExit("Nenhum workspace encontrado — abra o app uma vez para criá-lo.")
        wid = ws[0]["id"]

    all_rows: list[dict] = []
    for raw_city in a.municipio:
        city = title_city(raw_city)
        t0 = time.time()
        log(f"\n{city}/{uf}: limite municipal (Nominatim)...")
        boundary = municipality_boundary(city, uf)
        log("  consultando Overture (baixa só os blocos da região)...")
        places = query_places(con, release, boundary)
        closed = [x for x in places if x["operating_status"] in ("permanently_closed", "closed")]
        if not a.include_closed:
            places = [x for x in places if x not in closed]
        rows = [{
            "workspace_id": wid,
            "source": "overture",
            "source_id": x["id"],
            "release": release,
            "name": x["name"].strip()[:300],
            "category": x["category"],
            "categories": x["categories"] or [],
            "confidence": round(float(x["confidence"]), 3) if x["confidence"] is not None else None,
            "operating_status": x["operating_status"],
            "phones": x["phones"], "websites": x["websites"], "emails": x["emails"], "socials": x["socials"],
            "street": x["street"], "postcode": x["postcode"],
            "city": city, "state": uf,
            "latitude": x["latitude"], "longitude": x["longitude"],
            "datasets": x["datasets"] or [],
            "imported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        } for x in places]
        n = len(rows)
        log(f"  {n:,} locais · {sum(1 for r in rows if r['phones']):,} com telefone · {sum(1 for r in rows if r['websites']):,} com site · "
            f"{sum(1 for r in rows if r['emails']):,} com e-mail · {sum(1 for r in rows if r['socials']):,} com rede social"
            f"{f' · {len(closed)} fechados ignorados' if closed and not a.include_closed else ''} ({time.time() - t0:.0f}s)")
        if sb:
            for part in chunks(rows, 500):
                sb.req("POST", "places_pois?on_conflict=workspace_id,source,source_id", part, "resolution=merge-duplicates,return=minimal")
            log(f"  gravados em places_pois")
        all_rows.extend(rows)

    if a.output:
        out = Path(a.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        cols = ["name", "category", "phones", "websites", "emails", "socials", "street", "postcode", "city", "state", "latitude", "longitude", "confidence"]
        with open(out, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore", delimiter=";")
            w.writeheader()
            for r in all_rows:
                w.writerow({k: " | ".join(v) if isinstance(v, list) else v for k, v in r.items()})
        log(f"CSV: {out}")
    log("\nPronto. No Discovery, a fonte 'Overture Maps' já traz esses locais." if sb else "\nDry-run: nada gravado.")


if __name__ == "__main__":
    main()
