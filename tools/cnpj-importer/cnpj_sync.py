#!/usr/bin/env python3
"""
cnpj_sync — one-command sync of the official Receita Federal CNPJ open data
into Prospect Engine's database, filtered to the cities/niches you prospect.

    python tools/cnpj-importer/cnpj_sync.py --uf CE --municipio Sobral --preset restaurante --supabase
    python tools/cnpj-importer/cnpj_sync.py --uf CE --municipio Sobral --all-cnaes --supabase --socios

What it does (stdlib only — nothing to pip install):

1. Finds the latest monthly release on the official RFB repository
   (https://arquivos.receitafederal.gov.br, public share of Dados/Cadastros/CNPJ).
2. STREAMS each zip over HTTPS and inflates it on the fly — the 5+ GB
   national dataset is never written to disk (unless --keep-downloads).
   Interrupted downloads resume with HTTP Range from the byte they stopped at.
3. Pass 1 — Estabelecimentos0..9: keeps rows of the chosen UF / municípios /
   CNAEs (primary OR secondary CNAE), situação ATIVA by default.
4. Pass 2 — Empresas0..9: razão social, natureza jurídica, porte, capital.
5. Optional: Simples (MEI flag), Socios (quadro societário → decision makers).
6. Writes to Supabase (service role, from .env.local) WITHOUT overwriting:
   new CNPJs are inserted; existing ones only get registry fields
   (situação, razão social, CNAE, porte) refreshed and EMPTY contact fields
   filled. Also writes company_sources, company_contacts (sócios), the full
   CNAE table and an `imports` audit row. And/or writes a CSV (--output).

Companies WITHOUT nome fantasia are kept (razão social is the name) — the
old importer silently dropped them, which was most small businesses.

Data is public, official and licensed for reuse; only the subset you filter
is stored (see CNPJ_IMPORT.md / DATABASE.md storage policy).
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

SHARE_HOST = "https://arquivos.receitafederal.gov.br"
SHARE_TOKEN = os.environ.get("RFB_SHARE_TOKEN", "gn672Ad4CF8N6TK")
DAV_ROOT = "/public.php/webdav/Dados/Cadastros/CNPJ/"
USER_AGENT = "ProspectEngine-cnpj-sync/2.0 (+local prospecting tool)"
ROOT = Path(__file__).resolve().parents[2]

ESTABELECIMENTOS_COLUMNS = [
    "cnpj_basico", "cnpj_ordem", "cnpj_dv", "identificador_matriz_filial", "nome_fantasia",
    "situacao_cadastral", "data_situacao_cadastral", "motivo_situacao_cadastral", "nome_cidade_exterior",
    "pais", "data_inicio_atividade", "cnae_fiscal_principal", "cnae_fiscal_secundaria", "tipo_logradouro",
    "logradouro", "numero", "complemento", "bairro", "cep", "uf", "municipio", "ddd1", "telefone1", "ddd2",
    "telefone2", "ddd_fax", "fax", "correio_eletronico", "situacao_especial", "data_situacao_especial",
]
EMPRESAS_COLUMNS = ["cnpj_basico", "razao_social", "natureza_juridica", "qualificacao_responsavel", "capital_social", "porte", "ente_federativo"]
SOCIOS_COLUMNS = [
    "cnpj_basico", "identificador_socio", "nome_socio", "cpf_cnpj_socio", "qualificacao_socio", "data_entrada",
    "pais", "representante_legal", "nome_representante", "qualificacao_representante", "faixa_etaria",
]
SIMPLES_COLUMNS = ["cnpj_basico", "opcao_simples", "data_opcao_simples", "data_exclusao_simples", "opcao_mei", "data_opcao_mei", "data_exclusao_mei"]

SITUACAO = {"01": "NULA", "02": "ATIVA", "03": "SUSPENSA", "04": "INAPTA", "08": "BAIXADA"}
PORTE = {"01": "ME", "03": "EPP", "05": "DEMAIS"}

# Mirrors src/lib/discovery/industries.ts (primary + related CNAEs per niche).
PRESETS: dict[str, list[str]] = {
    "restaurante": ["5611-2/01", "5611-2/04", "5611-2/03", "5620-1/04", "5611-2/05", "5620-1/03"],
    "cafeteria": ["4721-1/02", "5611-2/04", "1091-1/02", "4721-1/03"],
    "clinica": ["8630-5/03", "8630-5/01", "8630-5/02", "8640-2/02"],
    "odontologia": ["8630-5/04"],
    "psicologia": ["8650-0/03"],
    "fisioterapia": ["8650-0/06"],
    "academia": ["9313-1/00", "8591-1/00"],
    "escola": ["8593-7/00", "8591-1/00", "8599-6/04", "8513-9/00", "8512-1/00", "8520-1/00"],
    "hotelaria": ["5510-8/01", "5510-8/03", "5510-8/02", "5590-6/99"],
    "imobiliaria": ["6821-8/01", "6821-8/02", "6822-6/00"],
    "construcao": ["4120-4/00", "4744-0/99"],
    "salao-beleza": ["9602-5/01", "9602-5/02"],
    "pet": ["4789-0/05", "7500-1/00", "9609-2/08"],
    "varejo": ["4781-4/00", "4754-7/01", "4782-2/01", "4774-1/00"],
    "automotivo": ["4520-0/01", "4511-1/01", "4530-7/03"],
    "arquitetura": ["7111-1/00", "7112-0/00"],
    "eventos": ["8230-0/01", "5620-1/02"],
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text or "") if unicodedata.category(c) != "Mn").lower().strip()


def format_cnae(raw: str) -> str | None:
    d = "".join(ch for ch in raw if ch.isdigit())
    return f"{d[0:4]}-{d[4]}/{d[5:7]}" if len(d) == 7 else None


def title_city(name: str) -> str:
    small = {"de", "da", "do", "das", "dos", "e"}
    return " ".join(w if i and w in small else w.capitalize() for i, w in enumerate(name.lower().split()))


def iso_date(raw: str) -> str | None:
    raw = (raw or "").strip()
    if len(raw) != 8 or not raw.isdigit() or raw == "00000000":
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


# ---------------------------------------------------------------------------
# Remote files (WebDAV public share) + streaming unzip with resume
# ---------------------------------------------------------------------------

def _auth_header() -> str:
    return "Basic " + base64.b64encode(f"{SHARE_TOKEN}:".encode()).decode()


def list_dir(path: str) -> list[tuple[str, int | None]]:
    req = urllib.request.Request(SHARE_HOST + path, method="PROPFIND", headers={"Depth": "1", "Authorization": _auth_header(), "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        xml = res.read().decode("utf-8")
    out: list[tuple[str, int | None]] = []
    for block in xml.split("<d:response>")[1:]:
        href = block.split("<d:href>")[1].split("</d:href>")[0]
        size = None
        if "<d:getcontentlength>" in block:
            size = int(block.split("<d:getcontentlength>")[1].split("<")[0])
        name = urllib.parse.unquote(href.rstrip("/").split("/")[-1])
        if href.rstrip("/") != path.rstrip("/"):
            out.append((name, size))
    return out


def latest_month() -> str:
    months = sorted(n for n, _ in list_dir(DAV_ROOT) if len(n) == 7 and n[4] == "-")
    if not months:
        raise SystemExit("Nenhum mês encontrado no repositório da Receita Federal.")
    return months[-1]


class RemoteZipMember(io.RawIOBase):
    """Readable stream of the first member of a remote .zip, inflated on the
    fly. Reconnects with `Range:` after network errors, keeping the inflate
    state, so a dropped connection doesn't restart a 2 GB download."""

    def __init__(self, url: str, label: str, progress: "Progress", keep_path: Path | None = None):
        self.url = url
        self.label = label
        self.progress = progress
        self.offset = 0
        self.res = None
        self.inflater = zlib.decompressobj(-15)
        self.pending = b""
        self.eof = False
        self.keep = open(keep_path, "wb") if keep_path else None
        self._open()
        self._read_local_header()

    def readable(self) -> bool:
        return True

    def _open(self) -> None:
        for attempt in range(1, 8):
            try:
                headers = {"Authorization": _auth_header(), "User-Agent": USER_AGENT}
                if self.offset:
                    headers["Range"] = f"bytes={self.offset}-"
                self.res = urllib.request.urlopen(urllib.request.Request(self.url, headers=headers), timeout=120)
                return
            except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
                wait = min(60, 2 ** attempt)
                log(f"  [{self.label}] falha ao conectar ({err}); nova tentativa em {wait}s ({attempt}/7)")
                time.sleep(wait)
        raise SystemExit(f"Não foi possível baixar {self.label} após várias tentativas.")

    def _raw(self, n: int) -> bytes:
        while True:
            try:
                chunk = self.res.read(n)
                self.offset += len(chunk)
                self.progress.add(len(chunk))
                if self.keep:
                    self.keep.write(chunk)
                return chunk
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
                log(f"  [{self.label}] conexão caiu em {self.offset / 1e6:.0f} MB ({err}) — retomando…")
                try:
                    self.res.close()
                except Exception:
                    pass
                self._open()

    def _read_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self._raw(n - len(buf))
            if not chunk:
                raise EOFError("zip truncado")
            buf += chunk
        return buf

    def _read_local_header(self) -> None:
        head = self._read_exact(30)
        if head[:4] != b"PK\x03\x04":
            raise ValueError(f"{self.label}: não é um zip")
        method = int.from_bytes(head[8:10], "little")
        name_len = int.from_bytes(head[26:28], "little")
        extra_len = int.from_bytes(head[28:30], "little")
        self._read_exact(name_len + extra_len)
        if method != 8:
            raise ValueError(f"{self.label}: método de compressão {method} não suportado")

    def readinto(self, b) -> int:  # type: ignore[override]
        while not self.pending and not self.eof:
            chunk = self._raw(1 << 20)
            if not chunk:
                self.pending = self.inflater.flush()
                self.eof = True
                break
            self.pending = self.inflater.decompress(chunk)
            if self.inflater.eof:
                self.eof = True
        n = min(len(b), len(self.pending))
        b[:n] = self.pending[:n]
        self.pending = self.pending[n:]
        return n

    def close(self) -> None:
        try:
            if self.res:
                self.res.close()
        finally:
            if self.keep:
                self.keep.close()
        super().close()


class LocalZipMember(io.RawIOBase):
    def __init__(self, path: Path):
        import zipfile

        self.zf = zipfile.ZipFile(path)
        self.fh = self.zf.open(self.zf.namelist()[0])

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:  # type: ignore[override]
        data = self.fh.read(len(b))
        b[: len(data)] = data
        return len(data)

    def close(self) -> None:
        self.fh.close()
        self.zf.close()
        super().close()


class Progress:
    def __init__(self, total: int):
        self.total = max(1, total)
        self.done = 0
        self.lock = threading.Lock()
        self.started = time.time()
        self.last = 0.0

    def add(self, n: int) -> None:
        with self.lock:
            self.done += n
            now = time.time()
            if now - self.last > 15:
                self.last = now
                rate = self.done / max(1, now - self.started)
                eta = (self.total - self.done) / max(1, rate)
                log(f"  ↓ {self.done / 1e9:.2f}/{self.total / 1e9:.2f} GB · {rate / 1e6:.1f} MB/s · ~{eta / 60:.0f} min restantes")


def csv_rows(month: str, filename: str, progress: Progress, keep_dir: Path | None):
    """Yields parsed rows of one RFB zip (latin-1, ';', quoted)."""
    local = keep_dir / month / filename if keep_dir else None
    if local and local.exists():
        raw: io.RawIOBase = LocalZipMember(local)
    else:
        if local:
            local.parent.mkdir(parents=True, exist_ok=True)
        raw = RemoteZipMember(SHARE_HOST + DAV_ROOT + f"{month}/{filename}", filename, progress, local.with_suffix(".part") if local else None)
    text = io.TextIOWrapper(io.BufferedReader(raw, buffer_size=1 << 20), encoding="latin-1", newline="")
    try:
        yield from csv.reader(text, delimiter=";", quotechar='"')
    finally:
        text.close()
        if local and not local.exists() and local.with_suffix(".part").exists():
            local.with_suffix(".part").rename(local)


# ---------------------------------------------------------------------------
# Filters / passes
# ---------------------------------------------------------------------------

@dataclass
class Filters:
    uf: set[str]
    municipio_codes: set[str] | None
    cnaes: set[str] | None
    secondary: bool
    situacoes: set[str]


@dataclass
class Stats:
    lines: int = 0
    matched: int = 0
    per_file: dict[str, int] = field(default_factory=dict)


def matches(rec: dict[str, str], f: Filters) -> bool:
    if rec["uf"] not in f.uf:
        return False
    if f.municipio_codes is not None and rec["municipio"] not in f.municipio_codes:
        return False
    if rec["situacao_cadastral"] not in f.situacoes:
        return False
    if f.cnaes is None:
        return True
    if format_cnae(rec["cnae_fiscal_principal"]) in f.cnaes:
        return True
    if f.secondary and rec["cnae_fiscal_secundaria"]:
        return any(format_cnae(c) in f.cnaes for c in rec["cnae_fiscal_secundaria"].split(","))
    return False


def pass_establishments(month: str, files: list[str], f: Filters, progress: Progress, parallel: int, keep: Path | None, work: Path) -> list[dict]:
    stats = Stats()
    lock = threading.Lock()
    work.mkdir(parents=True, exist_ok=True)

    def run(name: str) -> tuple[str, list[dict]]:
        part = work / f"{name}.jsonl"
        if part.exists():  # checkpoint: file already processed in a previous run
            with open(part, encoding="utf-8") as fh:
                return name, [json.loads(line) for line in fh]
        found: list[dict] = []
        n = 0
        for row in csv_rows(month, name, progress, keep):
            n += 1
            if len(row) < len(ESTABELECIMENTOS_COLUMNS):
                continue
            rec = dict(zip(ESTABELECIMENTOS_COLUMNS, (c.strip() for c in row)))
            if matches(rec, f):
                found.append(rec)
        tmp = part.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            for rec in found:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        tmp.rename(part)
        with lock:
            stats.lines += n
        log(f"  ✓ {name}: {n:,} linhas, {len(found):,} empresas no filtro")
        return name, found

    out: list[dict] = []
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        for fut in as_completed([pool.submit(run, name) for name in files]):
            _, found = fut.result()
            out.extend(found)
    return out


def pass_lookup(month: str, files: list[str], columns: list[str], wanted: set[str], progress: Progress, parallel: int, keep: Path | None, multi: bool = False) -> dict:
    result: dict = {}
    lock = threading.Lock()

    def run(name: str) -> None:
        local: dict = {}
        for row in csv_rows(month, name, progress, keep):
            if not row or row[0] not in wanted or len(row) < len(columns):
                continue
            rec = dict(zip(columns, (c.strip() for c in row)))
            if multi:
                local.setdefault(row[0], []).append(rec)
            else:
                local[row[0]] = rec
        with lock:
            for k, v in local.items():
                if multi:
                    result.setdefault(k, []).extend(v)
                else:
                    result[k] = v
        log(f"  ✓ {name}")

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        for fut in as_completed([pool.submit(run, n) for n in files]):
            fut.result()
    return result


def small_table(month: str, filename: str, keep: Path | None) -> dict[str, str]:
    progress = Progress(1)
    return {row[0].strip(): row[1].strip() for row in csv_rows(month, filename, progress, keep) if len(row) >= 2}


# ---------------------------------------------------------------------------
# Supabase (PostgREST) writer
# ---------------------------------------------------------------------------

class Supabase:
    def __init__(self):
        env = read_env(ROOT / ".env.local")
        self.url = (env.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
        self.key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
        if not self.url or not self.key:
            raise SystemExit("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em .env.local")

    def req(self, method: str, path: str, body=None, prefer: str | None = None):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json", "User-Agent": USER_AGENT}
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(1, 6):
            try:
                with urllib.request.urlopen(urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data, method=method, headers=headers), timeout=120) as res:
                    raw = res.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")[:400]
                if err.code in (429, 500, 502, 503, 504) and attempt < 5:
                    time.sleep(2 ** attempt)
                    continue
                raise SystemExit(f"Supabase {method} {path.split('?')[0]} → HTTP {err.code}: {detail}")
            except (urllib.error.URLError, TimeoutError) as err:
                if attempt < 5:
                    time.sleep(2 ** attempt)
                    continue
                raise SystemExit(f"Supabase inacessível: {err}")


def read_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def chunks(items: list, n: int):
    for i in range(0, len(items), n):
        yield items[i : i + n]


# ---------------------------------------------------------------------------
# Record building
# ---------------------------------------------------------------------------

def build_company(rec: dict, emp: dict | None, simples: dict | None, municipios: dict[str, str], month: str) -> dict:
    cnpj = rec["cnpj_basico"].zfill(8) + rec["cnpj_ordem"].zfill(4) + rec["cnpj_dv"].zfill(2)
    phones = []
    raw_phones = []
    for ddd, tel in ((rec["ddd1"], rec["telefone1"]), (rec["ddd2"], rec["telefone2"])):
        ddd_d = "".join(c for c in ddd if c.isdigit())[-2:]
        num = "".join(c for c in tel if c.isdigit())
        if len(ddd_d) != 2 or len(num) < 8:
            continue
        raw_phones.append(f"({ddd_d}) {num}")
        # ANATEL: every BR mobile (8 digits starting 6-9) gained a leading 9 (completed 2016).
        # The RFB file still carries many pre-2016 numbers; the original stays in raw_ref.
        if len(num) == 8 and num[0] in "6789":
            num = "9" + num
        phones.append(f"({ddd_d}) {num[:-4]}-{num[-4:]}")
    street = f"{rec['tipo_logradouro']} {rec['logradouro']}".strip() or None
    secondary = [c for c in (format_cnae(x) for x in rec["cnae_fiscal_secundaria"].split(",")) if c] if rec["cnae_fiscal_secundaria"] else []
    porte = PORTE.get((emp or {}).get("porte", ""))
    if simples and simples.get("opcao_mei") == "S" and not simples.get("data_exclusao_mei", "").strip("0"):
        porte = "MEI"
    return {
        "cnpj": cnpj,
        "trade_name": rec["nome_fantasia"] or None,
        "legal_name": (emp or {}).get("razao_social") or None,
        "cnpj_status": SITUACAO.get(rec["situacao_cadastral"], "UNKNOWN"),
        "cnpj_status_date": iso_date(rec["data_situacao_cadastral"]),
        "opened_at": iso_date(rec["data_inicio_atividade"]),
        "legal_nature": (emp or {}).get("natureza_juridica") or None,
        "cnae_primary": format_cnae(rec["cnae_fiscal_principal"]),
        "cnae_secondary": secondary,
        "official_size": {"value": porte, "source": f"RFB Dados Abertos {month}", "source_date": f"{month}-01", "confidence": "HIGH"} if porte else {},
        "street": street,
        "street_number": rec["numero"] if rec["numero"] and rec["numero"].upper() not in ("S/N", "SN") else None,
        "complement": rec["complemento"] or None,
        "neighborhood": rec["bairro"] or None,
        "city": title_city(municipios.get(rec["municipio"], "")) or None,
        "state": rec["uf"],
        "postal_code": rec["cep"] or None,
        "phone": phones[0] if phones else None,
        "phone_normalized": "+55" + "".join(c for c in phones[0] if c.isdigit()) if phones else None,
        "email": rec["correio_eletronico"].lower() or None,
        "_phones": phones,
        "_raw_phones": raw_phones,
        "_matriz": rec["identificador_matriz_filial"] == "1",
    }


def quality(c: dict) -> int:
    score = 20 + (15 if c.get("phone") else 0) + (10 if c.get("email") else 0) + (10 if c.get("trade_name") or c.get("legal_name") else 0)
    score += 10 if c.get("street") and c.get("city") else 0
    return min(100, score)


def provenance(c: dict, month: str) -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    fields = {"name": c.get("trade_name") or c.get("legal_name"), "legalName": c.get("legal_name"), "cnpj": c["cnpj"], "street": c.get("street"),
              "houseNumber": c.get("street_number"), "neighborhood": c.get("neighborhood"), "city": c.get("city"), "postcode": c.get("postal_code"),
              "phone": c.get("phone"), "email": c.get("email")}
    return {k: {"value": v, "source": f"cnpj_rfb_{month}", "confidence": "HIGH", "collected_at": now, "verified_at": now} for k, v in fields.items() if v}


def write_supabase(companies: list[dict], socios: dict, qualificacoes: dict[str, str], cnaes_table: dict[str, str], month: str, label: str) -> dict:
    sb = Supabase()
    ws = sb.req("GET", "workspaces?select=id,name&limit=1")
    if not ws:
        raise SystemExit("Nenhum workspace encontrado — abra o app uma vez para criá-lo.")
    wid = ws[0]["id"]
    # field_provenance comes with migration 0011; degrade instead of failing if it isn't applied.
    try:
        sb.req("GET", "companies?select=field_provenance&limit=1")
        has_provenance = True
    except SystemExit:
        has_provenance = False
        log("  (migration 0011 não aplicada — gravando sem procedência por campo)")
    stage = sb.req("GET", f"pipeline_stages?select=id&workspace_id=eq.{wid}&key=eq.NEW&limit=1")
    stage_id = stage[0]["id"] if stage else None
    log(f"Workspace: {ws[0]['name']}")

    # Full CNAE table first (companies.cnae_primary has an FK to cnaes).
    rows = [{"code": fc, "description": d} for code, d in cnaes_table.items() if (fc := format_cnae(code))]
    for part in chunks(rows, 1000):
        sb.req("POST", "cnaes?on_conflict=code", part, "resolution=merge-duplicates,return=minimal")
    log(f"  {len(rows):,} CNAEs sincronizados")

    # Map CNAE → workspace/global industry so imported companies get a niche.
    links = sb.req("GET", "industry_cnaes?select=industry_id,cnae_code&limit=10000") or []
    inds = {i["id"]: i for i in (sb.req("GET", f"industries?select=id,workspace_id&or=(workspace_id.is.null,workspace_id.eq.{wid})&limit=10000") or [])}
    cnae_to_industry: dict[str, str] = {}
    for l in links:
        ind = inds.get(l["industry_id"])
        if not ind:
            continue
        if l["cnae_code"] not in cnae_to_industry or ind["workspace_id"]:
            cnae_to_industry[l["cnae_code"]] = l["industry_id"]

    # Existing CNPJs → complement only.
    existing: dict[str, dict] = {}
    all_cnpjs = [c["cnpj"] for c in companies]
    for part in chunks(all_cnpjs, 150):
        got = sb.req("GET", f"companies?select=id,cnpj,trade_name,legal_name,phone,email,street,street_number,neighborhood,postal_code,industry_id&workspace_id=eq.{wid}&cnpj=in.({','.join(part)})") or []
        for g in got:
            existing[g["cnpj"]] = g

    created = updated = 0
    new_rows, sources, contacts = [], [], []
    for c in companies:
        public = {k: v for k, v in c.items() if not k.startswith("_")}
        industry_id = cnae_to_industry.get(c["cnae_primary"] or "") or next((cnae_to_industry[s] for s in c["cnae_secondary"] if s in cnae_to_industry), None)
        cur = existing.get(c["cnpj"])
        if cur:
            patch = {k: public[k] for k in ("cnpj_status", "cnpj_status_date", "legal_name", "legal_nature", "cnae_primary", "cnae_secondary", "official_size", "opened_at")}
            for k in ("trade_name", "phone", "email", "street", "street_number", "neighborhood", "postal_code"):
                if not cur.get(k) and public.get(k):
                    patch[k] = public[k]
            if not cur.get("industry_id") and industry_id:
                patch["industry_id"] = industry_id
            patch["last_verified_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            sb.req("PATCH", f"companies?id=eq.{cur['id']}", patch, "return=minimal")
            updated += 1
            continue
        cid = str(uuid.uuid4())
        new_rows.append({
            **public,
            "id": cid,
            "workspace_id": wid,
            "industry_id": industry_id,
            "pipeline_stage_id": stage_id,
            "data_quality_score": quality(public),
            "last_verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "tags": ["cnpj-rfb"] + (["filial"] if not c["_matriz"] else []),
            **({"field_provenance": provenance(public, month)} if has_provenance else {}),
        })
        sources.append({"workspace_id": wid, "company_id": cid, "source_type": "CNPJ", "source_name": f"Receita Federal — Dados Abertos CNPJ ({month})",
                        "source_url": "https://www.gov.br/receitafederal/dados", "source_record_id": c["cnpj"], "confidence": "HIGH",
                        "raw_ref": {"dataset": month, "other_phones": c["_phones"][1:], "phones_as_registered": c["_raw_phones"]}})
        for s in socios.get(c["cnpj"][:8], [])[:10]:
            if s.get("nome_socio"):
                contacts.append({"workspace_id": wid, "company_id": cid, "name": s["nome_socio"].title(), "role": qualificacoes.get(s["qualificacao_socio"]),
                                 "contact_type": "SOCIO", "evidence_source": f"Quadro societário público — Receita Federal ({month})", "confidence": "HIGH", "channel_priority": 3})

    # A partial failure below must not leave companies without their source rows.
    for part in chunks(new_rows, 500):
        sb.req("POST", "companies", part, "return=minimal")
        created += len(part)
        log(f"  {created:,}/{len(new_rows):,} empresas inseridas")
    for part in chunks(sources, 1000):
        sb.req("POST", "company_sources", part, "return=minimal")
    for part in chunks(contacts, 1000):
        sb.req("POST", "company_contacts", part, "return=minimal")

    sb.req("POST", "imports", {
        "workspace_id": wid, "file_name": f"RFB CNPJ {month} — {label}", "source_type": "CNPJ_DATASET", "status": "SUCCESS",
        "dataset_version": month, "source_date": f"{month}-01", "total_rows": len(companies), "processed_rows": len(companies),
        "created_count": created, "updated_count": updated, "duplicate_count": 0, "error_count": 0,
        "idempotency_key": f"rfb-{month}-{label}-{int(time.time())}",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, "return=minimal")
    return {"created": created, "updated": updated, "contacts": len(contacts)}


# ---------------------------------------------------------------------------

def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
        except Exception:
            pass
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", action="append", required=True, help="UF (repetível): --uf CE --uf PI")
    p.add_argument("--municipio", action="append", help="Município (nome, repetível). Omitir = UF inteira")
    p.add_argument("--preset", action="append", choices=sorted(PRESETS), help="Nicho pronto (CNAEs principal + correlatos)")
    p.add_argument("--cnae", action="append", help="CNAE extra, ex.: 5611-2/01 (repetível)")
    p.add_argument("--all-cnaes", action="store_true", help="Todas as atividades (todas as empresas do município)")
    p.add_argument("--primary-only", action="store_true", help="Casar só o CNAE principal (padrão: principal OU secundário)")
    p.add_argument("--include-inactive", action="store_true", help="Incluir SUSPENSA/INAPTA/BAIXADA/NULA (padrão: só ATIVA)")
    p.add_argument("--socios", action="store_true", help="Baixar quadro societário (+~700 MB) → decisores")
    p.add_argument("--simples", action="store_true", help="Baixar Simples Nacional (+~300 MB) → marca MEI")
    p.add_argument("--month", help="Mês AAAA-MM (padrão: o mais recente)")
    p.add_argument("--supabase", action="store_true", help="Gravar direto no banco do app (.env.local)")
    p.add_argument("--output", help="Também gravar CSV")
    p.add_argument("--parallel", type=int, default=4, help="Downloads simultâneos (padrão 4)")
    p.add_argument("--keep-downloads", help="Pasta para guardar os .zip (reuso em outras cidades no mesmo mês)")
    p.add_argument("--dry-run", action="store_true", help="Não grava nada no banco; só mostra contagens")
    p.add_argument("--sample", action="store_true", help="Teste rápido: só 1 arquivo de Estabelecimentos e 1 de Empresas")
    a = p.parse_args()

    if not a.all_cnaes and not a.preset and not a.cnae:
        raise SystemExit("Informe --preset, --cnae ou --all-cnaes.")
    if not a.supabase and not a.output and not a.dry_run:
        raise SystemExit("Informe --supabase e/ou --output (ou --dry-run).")

    month = a.month or latest_month()
    keep = Path(a.keep_downloads) if a.keep_downloads else None
    listing = dict(list_dir(DAV_ROOT + f"{month}/"))
    log(f"Dados Abertos CNPJ — release {month}")

    municipios = small_table(month, "Municipios.zip", keep)
    cnaes_table = small_table(month, "Cnaes.zip", keep)
    qualificacoes = small_table(month, "Qualificacoes.zip", keep) if a.socios else {}

    codes = None
    if a.municipio:
        wanted = {fold(m) for m in a.municipio}
        codes = {code for code, name in municipios.items() if fold(name) in wanted}
        if len(codes) < len(wanted):
            found = {fold(municipios[c]) for c in codes}
            log(f"Aviso: município(s) não encontrados na tabela da RFB: {', '.join(sorted(wanted - found))}")
        if not codes:
            raise SystemExit("Nenhum município encontrado.")
        log(f"Municípios: {', '.join(title_city(municipios[c]) + ' (' + c + ')' for c in sorted(codes))}  — nomes homônimos de outras UFs são excluídos pelo filtro de UF")

    cnae_set = None
    if not a.all_cnaes:
        cnae_set = set(a.cnae or [])
        for preset in a.preset or []:
            cnae_set.update(PRESETS[preset])
        log(f"CNAEs ({'principal' if a.primary_only else 'principal ou secundário'}): {', '.join(sorted(cnae_set))}")

    filters = Filters(
        uf={u.upper() for u in a.uf},
        municipio_codes=codes,
        cnaes=cnae_set,
        secondary=not a.primary_only,
        situacoes=set(SITUACAO) if a.include_inactive else {"02"},
    )

    est_files = sorted(n for n in listing if n.startswith("Estabelecimentos"))
    emp_files = sorted(n for n in listing if n.startswith("Empresas"))
    if a.sample:
        est_files = [n for n in est_files if n == "Estabelecimentos1.zip"] or est_files[:1]
        emp_files = [n for n in emp_files if n == "Empresas1.zip"] or emp_files[:1]
        log("Modo --sample: 1 arquivo de cada (a contagem final será ~1/10 do real)")
    total = sum(listing[n] or 0 for n in est_files)
    label = f"{'/'.join(sorted(filters.uf))}{'-' + '-'.join(sorted(fold(m) for m in a.municipio)) if a.municipio else ''}-{'all' if a.all_cnaes else '-'.join(a.preset or ['cnae'])}"
    work = ROOT / "tools" / "cnpj-importer" / "output" / (f"work-{month}-{label}" + ("-sample" if a.sample else "")).replace("/", "_")

    log(f"\n[1/3] Estabelecimentos ({total / 1e9:.1f} GB em streaming, {a.parallel} em paralelo; checkpoint em {work})")
    est = pass_establishments(month, est_files, filters, Progress(total), a.parallel, keep, work)
    log(f"      → {len(est):,} estabelecimentos no filtro")
    if not est:
        log("Nada a importar.")
        return

    basicos = {r["cnpj_basico"] for r in est}
    log(f"\n[2/3] Empresas (razão social, porte, natureza) para {len(basicos):,} CNPJs básicos")
    empresas = pass_lookup(month, emp_files, EMPRESAS_COLUMNS, basicos, Progress(sum(listing[n] or 0 for n in emp_files)), a.parallel, keep)
    simples = {}
    if a.simples:
        simples = pass_lookup(month, ["Simples.zip"], SIMPLES_COLUMNS, basicos, Progress(listing.get("Simples.zip") or 1), 1, keep)
    socios = {}
    if a.socios:
        soc_files = sorted(n for n in listing if n.startswith("Socios"))
        log("      + Sócios")
        socios = pass_lookup(month, soc_files, SOCIOS_COLUMNS, basicos, Progress(sum(listing[n] or 0 for n in soc_files)), a.parallel, keep, multi=True)

    companies = [build_company(r, empresas.get(r["cnpj_basico"]), simples.get(r["cnpj_basico"]), municipios, month) for r in est]
    with_phone = sum(1 for c in companies if c["phone"])
    with_email = sum(1 for c in companies if c["email"])
    log(f"\n      {len(companies):,} empresas · {with_phone:,} com telefone · {with_email:,} com e-mail · "
        f"{sum(1 for c in companies if not c['trade_name']):,} sem nome fantasia (usam razão social)")

    if a.output:
        out = Path(a.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        cols = ["cnpj", "trade_name", "legal_name", "cnpj_status", "cnae_primary", "street", "street_number", "neighborhood", "city", "state", "postal_code", "phone", "email", "opened_at"]
        with open(out, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore", delimiter=";")
            w.writeheader()
            w.writerows(companies)
        log(f"CSV: {out}")

    if a.dry_run:
        log("Dry-run: nada gravado no banco.")
        return
    if a.supabase:
        log("\n[3/3] Gravando no Supabase (sem sobrescrever dados existentes)")
        res = write_supabase(companies, socios, qualificacoes, cnaes_table, month, label)
        log(f"\nConcluído: {res['created']:,} criadas · {res['updated']:,} já existiam (atualizadas só no cadastral/vazios) · {res['contacts']:,} sócios")
        log("Agora rode a busca no Discovery — a fonte 'Banco local' vai trazer essas empresas.")


if __name__ == "__main__":
    main()
