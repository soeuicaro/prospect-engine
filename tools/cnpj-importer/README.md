# cnpj-importer

Local preprocessor for the Receita Federal "Dados Abertos CNPJ" dataset. Runs entirely on your machine — never uploads the raw national dataset anywhere. Produces a small, filtered CSV you upload through the app's **Imports** page.

No dependencies beyond Python 3.9+ standard library (`csv`, `json`, `argparse`). Nothing to `pip install`.

## Why this exists

The full CNPJ dataset is tens of GB across dozens of files. Prospect Engine's Supabase free-tier database should never hold the national dataset — only the companies you actually prospect (see `../../DATABASE.md`). This script filters by UF and CNAE **before** anything touches the app.

## 1. Download the raw data

From <https://dadosabertos.rfb.gov.br/CNPJ/>, download the most recent:

- One or more `Estabelecimentos*.zip` files (contains address, phone, CNAE, situação cadastral)
- `Municipios.zip` (small lookup table: numeric city code → city name)

Extract both into `input/` (already gitignored):

```
tools/cnpj-importer/input/K3241.K03200Y0.D60106.ESTABELE
tools/cnpj-importer/input/Municipios.csv
```

## 2. Run

```bash
python cnpj_importer.py \
  --input-dir input \
  --output output/restaurantes_ce.csv \
  --uf CE \
  --cnae 5611-2/01 --cnae 5611-2/03 \
  --municipios-lookup input/Municipios.csv \
  --checkpoint output/checkpoint.json
```

- `--uf` / `--cnae` can repeat to include multiple values.
- `--municipios-lookup` resolves the numeric city code to a name. Without it, `city` is left blank (never guessed) and the raw code is kept in `municipio_codigo`.
- `--checkpoint` makes re-runs resumable and idempotent — safe to Ctrl+C and continue later.
- `--limit N` stops after N exported rows, useful for a quick test run.

## 3. Import

Upload `output/restaurantes_ce.csv` on the **Imports** page in the app. The output headers already match the app's importable fields (`trade_name`, `cnpj`, `phone`, `email`, `street`, `neighborhood`, `city`, `state`, `postal_code`) plus a few extra reference columns (`cnae`, `situacao_cadastral`, `data_abertura`, `municipio_codigo`) you can map or skip.

## Notes

- **Never affirms a fact without a value.** A missing phone/e-mail/city is left blank, never fabricated.
- The RFB layout is publicly documented but can change between dataset releases — if columns look shifted, check `ESTABELECIMENTOS_COLUMNS` in `cnpj_importer.py` against RFB's current layout notes.
- Large output files should not be committed to git (already covered by the repo's `.gitignore`).
