#!/usr/bin/env python3
"""
cnpj-importer — local preprocessor for the Receita Federal "Dados Abertos
CNPJ" dataset (https://dadosabertos.rfb.gov.br/CNPJ/).

Purpose: the national CNPJ dataset is tens of gigabytes across dozens of
files. We never want to load it into the app's Supabase database directly
(see DATABASE.md storage-economy policy and PROMPT MASTER §13). This script
runs LOCALLY, filters the raw "Estabelecimentos" file down to the UF/CNAE
you actually prospect in, and writes a compact CSV that matches Prospect
Engine's CSV importer column headers — ready to upload from Imports page.

Zero-cost / stdlib-only: no pip dependencies required. Uses only the Python
standard library so it runs anywhere with Python 3.9+.

USAGE
-----
1. Download + extract one or more "EstabelecimentosN.zip" files from
   https://dadosabertos.rfb.gov.br/CNPJ/ into tools/cnpj-importer/input/
   (extracted .csv/.txt files — do not commit them, see .gitignore).
2. Run:
     python cnpj_importer.py --input-dir input --uf CE --cnae 5611-2/01 \
         --output output/restaurantes_ce.csv
3. Upload output/restaurantes_ce.csv on the Imports page.

Resumable: pass --checkpoint to persist progress and safely re-run after an
interruption (idempotent — same output row is never appended twice for the
same input line).

IMPORTANT: the RFB layout below reflects the commonly documented public
"Estabelecimentos" file structure. RFB may revise column order between
dataset releases — verify against the current layout notes published
alongside the dataset before a large production run, and adjust
ESTABELECIMENTOS_COLUMNS below if needed.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Column order for the RFB "Estabelecimentos" file (semicolon-delimited,
# latin-1 encoded, no header row).
ESTABELECIMENTOS_COLUMNS = [
    "cnpj_basico",
    "cnpj_ordem",
    "cnpj_dv",
    "identificador_matriz_filial",
    "nome_fantasia",
    "situacao_cadastral",
    "data_situacao_cadastral",
    "motivo_situacao_cadastral",
    "nome_cidade_exterior",
    "pais",
    "data_inicio_atividade",
    "cnae_fiscal_principal",
    "cnae_fiscal_secundaria",
    "tipo_logradouro",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cep",
    "uf",
    "municipio",
    "ddd1",
    "telefone1",
    "ddd2",
    "telefone2",
    "ddd_fax",
    "fax",
    "correio_eletronico",
    "situacao_especial",
    "data_situacao_especial",
]

SITUACAO_LABELS = {
    "01": "NULA",
    "02": "ATIVA",
    "03": "SUSPENSA",
    "04": "INAPTA",
    "08": "BAIXADA",
}

OUTPUT_HEADERS = [
    "trade_name",
    "cnpj",
    "phone",
    "email",
    "street",
    "neighborhood",
    "city",
    "state",
    "postal_code",
    "cnae",
    "situacao_cadastral",
    "data_abertura",
    "municipio_codigo",
]


def load_municipios_lookup(path: Path | None) -> dict[str, str]:
    """
    RFB's Estabelecimentos file only stores a numeric municipality CODE, not
    a name — the name lives in a separate "Municipios" reference file
    published alongside the dataset (format: codigo;nome, semicolon-
    delimited, latin-1). Pass --municipios-lookup pointing at that file to
    resolve city names; otherwise `city` is left blank (UNKNOWN, never
    guessed) and the raw code is kept in `municipio_codigo` for reference.
    """
    if not path:
        return {}
    lookup: dict[str, str] = {}
    with open(path, encoding="latin-1", newline="") as f:
        for row in csv.reader(f, delimiter=";", quotechar='"'):
            if len(row) >= 2:
                lookup[row[0].strip()] = row[1].strip()
    return lookup


def format_cnae(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) != 7:
        return raw
    return f"{digits[0:4]}-{digits[4]}/{digits[5:7]}"


def format_cnpj(basico: str, ordem: str, dv: str) -> str:
    b = basico.zfill(8)
    o = ordem.zfill(4)
    d = dv.zfill(2)
    return f"{b[0:2]}.{b[2:5]}.{b[5:8]}/{o}-{d}"


@dataclass
class ImportStats:
    total_lines: int = 0
    matched: int = 0
    written: int = 0
    errors: int = 0
    files_processed: list[str] = field(default_factory=list)


def load_checkpoint(path: Path | None) -> dict:
    if path and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"processed_files": {}}


def save_checkpoint(path: Path | None, checkpoint: dict) -> None:
    if path:
        path.write_text(json.dumps(checkpoint, indent=2), encoding="utf-8")


def process_file(
    input_path: Path,
    writer: csv.DictWriter,
    uf_filter: set[str] | None,
    cnae_filter: set[str] | None,
    resume_from_line: int,
    stats: ImportStats,
    municipios: dict[str, str],
) -> int:
    """Returns the last line number processed (for checkpointing)."""
    last_line = resume_from_line
    with open(input_path, encoding="latin-1", newline="") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        for line_no, row in enumerate(reader, start=1):
            if line_no <= resume_from_line:
                continue
            stats.total_lines += 1
            last_line = line_no

            if len(row) < len(ESTABELECIMENTOS_COLUMNS):
                stats.errors += 1
                continue

            rec = dict(zip(ESTABELECIMENTOS_COLUMNS, row))

            if uf_filter and rec["uf"].strip().upper() not in uf_filter:
                continue

            cnae_formatted = format_cnae(rec["cnae_fiscal_principal"].strip())
            if cnae_filter and cnae_formatted not in cnae_filter:
                continue

            stats.matched += 1

            trade_name = rec["nome_fantasia"].strip()
            if not trade_name:
                # No fantasia name on file — skip rather than fabricate one.
                continue

            phone = ""
            if rec["ddd1"].strip() and rec["telefone1"].strip():
                phone = f"({rec['ddd1'].strip()}) {rec['telefone1'].strip()}"

            situacao = SITUACAO_LABELS.get(rec["situacao_cadastral"].strip(), "UNKNOWN")
            municipio_codigo = rec["municipio"].strip()
            city = municipios.get(municipio_codigo, "")

            writer.writerow(
                {
                    "trade_name": trade_name,
                    "cnpj": format_cnpj(rec["cnpj_basico"], rec["cnpj_ordem"], rec["cnpj_dv"]),
                    "phone": phone,
                    "email": rec["correio_eletronico"].strip().lower(),
                    "street": f"{rec['tipo_logradouro'].strip()} {rec['logradouro'].strip()}".strip(),
                    "neighborhood": rec["bairro"].strip(),
                    "city": city,
                    "state": rec["uf"].strip().upper(),
                    "postal_code": rec["cep"].strip(),
                    "cnae": cnae_formatted,
                    "situacao_cadastral": situacao,
                    "data_abertura": rec["data_inicio_atividade"].strip(),
                    "municipio_codigo": municipio_codigo,
                }
            )
            stats.written += 1

            if stats.total_lines % 100_000 == 0:
                print(f"  ... {stats.total_lines:,} linhas lidas, {stats.written:,} exportadas", file=sys.stderr)

    return last_line


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", required=True, help="Diretório com os arquivos Estabelecimentos extraídos")
    parser.add_argument("--output", required=True, help="Caminho do CSV de saída")
    parser.add_argument("--uf", action="append", help="Filtrar por UF (pode repetir, ex: --uf CE --uf PI)")
    parser.add_argument("--cnae", action="append", help="Filtrar por CNAE formatado, ex: 5611-2/01 (pode repetir)")
    parser.add_argument("--checkpoint", help="Arquivo JSON de checkpoint para retomar processamento")
    parser.add_argument("--limit", type=int, help="Parar após N linhas exportadas (útil para testes)")
    parser.add_argument(
        "--municipios-lookup",
        help="CSV oficial 'Municipios' (codigo;nome) para resolver nomes de cidade a partir do código",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    municipios = load_municipios_lookup(Path(args.municipios_lookup) if args.municipios_lookup else None)

    uf_filter = {u.upper() for u in args.uf} if args.uf else None
    cnae_filter = set(args.cnae) if args.cnae else None
    checkpoint_path = Path(args.checkpoint) if args.checkpoint else None
    checkpoint = load_checkpoint(checkpoint_path)

    input_files = sorted(
        p for p in input_dir.iterdir() if p.is_file() and "ESTABELE" in p.name.upper()
    )
    if not input_files:
        print(f"Nenhum arquivo 'Estabelecimentos' encontrado em {input_dir}", file=sys.stderr)
        sys.exit(1)

    stats = ImportStats()
    file_exists = output_path.exists() and checkpoint.get("processed_files")
    mode = "a" if file_exists else "w"

    with open(output_path, mode, newline="", encoding="utf-8") as out_f:
        writer = csv.DictWriter(out_f, fieldnames=OUTPUT_HEADERS)
        if mode == "w":
            writer.writeheader()

        for input_path in input_files:
            resume_from = checkpoint["processed_files"].get(str(input_path), 0)
            print(f"Processando {input_path.name} (a partir da linha {resume_from})...", file=sys.stderr)
            try:
                last_line = process_file(input_path, writer, uf_filter, cnae_filter, resume_from, stats, municipios)
                checkpoint["processed_files"][str(input_path)] = last_line
                save_checkpoint(checkpoint_path, checkpoint)
                stats.files_processed.append(input_path.name)
            except KeyboardInterrupt:
                print("\nInterrompido — checkpoint salvo, pode retomar depois.", file=sys.stderr)
                save_checkpoint(checkpoint_path, checkpoint)
                sys.exit(130)

            if args.limit and stats.written >= args.limit:
                print(f"Limite de {args.limit} linhas atingido.", file=sys.stderr)
                break

    print(
        f"\nConcluído: {stats.total_lines:,} linhas lidas, {stats.matched:,} corresponderam aos "
        f"filtros, {stats.written:,} exportadas, {stats.errors} linhas com erro.",
        file=sys.stderr,
    )
    print(f"Saída: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
