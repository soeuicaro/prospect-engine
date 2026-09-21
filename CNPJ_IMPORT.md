# CNPJ Import

## Where to get the data

<https://dadosabertos.rfb.gov.br/CNPJ/> — official Receita Federal open data. Download:

- One or more `Estabelecimentos*.zip` (this is what has address/phone/CNAE/situação cadastral — the file you actually need)
- `Municipios.zip` (small lookup: numeric city code → name)

Extract both.

## How to filter

You do not want the national dataset in the app's database. Run the local preprocessor:

```bash
cd tools/cnpj-importer
python cnpj_importer.py \
  --input-dir /path/to/extracted/estabelecimentos \
  --output output/my_city.csv \
  --uf CE \
  --cnae 5611-2/01 --cnae 5611-2/03 \
  --municipios-lookup /path/to/Municipios.csv \
  --checkpoint output/checkpoint.json
```

Full flag reference and a worked example: `tools/cnpj-importer/README.md`.

## How to import

Upload the resulting CSV on the **Imports** page (`/imports`). The tool's output headers already match the app's column mapper (`trade_name`, `cnpj`, `phone`, `email`, `street`, `neighborhood`, `city`, `state`, `postal_code`); extra columns (`cnae`, `situacao_cadastral`, `data_abertura`, `municipio_codigo`) can be mapped or left as "Ignorar coluna."

## How to update

RFB republishes the dataset roughly monthly. Re-download, re-run the local tool (a fresh `--checkpoint` file, or delete the old one to reprocess from scratch), and re-import — the app's dedup logic (`lib/domain/dedup.ts`, matched on CNPJ/domain/phone/email/name+city) skips exact/likely duplicates automatically rather than creating a second copy of every company.

## Limits in V1

- The app's CSV importer processes up to 2,000 rows per upload in a single request (serverless timeout safety margin — see `ARCHITECTURE.md`). Split larger exports from the local tool, or re-run it with a narrower `--cnae`/`--uf` filter per file.
- The local tool currently parses the **Estabelecimentos** file only (address/contact/CNAE/situação). It does not yet join `Empresas` (razão social, porte, capital social) or `Socios`/QSA (partner names) — those are documented as a roadmap extension to `cnpj_importer.py`, not fabricated in the meantime. `legal_name`, `official_size`, and decision-maker contacts from CNPJ data are left blank until that join is built; add them manually or via the website/OSM paths in the meantime.
- Never scrape the Receita Federal website directly — always use the official bulk dataset.
