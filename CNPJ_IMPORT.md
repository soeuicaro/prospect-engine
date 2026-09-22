# CNPJ Import — maximum coverage

The Receita Federal open CNPJ data is the source that actually brings **every active company of a city**
(OSM only has the few places mapped by volunteers — ~30 restaurants in Sobral vs hundreds with CNPJ).

## One command: `cnpj_sync.py` (recommended)

```bash
# every active company of the city, with partners (decision makers) and MEI flag
npm run cnpj:sync -- --uf CE --municipio Sobral --all-cnaes --socios --simples --supabase

# one niche only (primary OR secondary CNAE)
npm run cnpj:sync -- --uf CE --municipio Sobral --preset restaurante --supabase

# several cities / the whole state
npm run cnpj:sync -- --uf CE --municipio Sobral --municipio Forquilha --preset clinica --supabase
npm run cnpj:sync -- --uf CE --preset restaurante --supabase

# quick check: 1 of 10 files, no writes
npm run cnpj:sync -- --uf CE --municipio Sobral --all-cnaes --sample --dry-run
```

What it does:

- Finds the latest month on the official repository (`arquivos.receitafederal.gov.br`, public share of
  `Dados/Cadastros/CNPJ`; override the share token with `RFB_SHARE_TOKEN` if the Receita changes it).
- **Streams** every zip over HTTPS and inflates on the fly — nothing is written to disk unless
  `--keep-downloads DIR` (reuse the zips for other cities in the same month). Dropped connections resume
  with HTTP Range. `--parallel N` downloads (default 4). Per-file checkpoints in `tools/cnpj-importer/output/work-*`.
- Pass 1 `Estabelecimentos0..9` (~5.4 GB): UF + município + CNAE (primary **or secondary**, unless
  `--primary-only`), situação ATIVA only unless `--include-inactive`.
- Pass 2 `Empresas0..9` (~1.4 GB): razão social, natureza jurídica, porte.
- `--socios` (~0.7 GB): public partner list → `company_contacts` (SOCIO). `--simples` (~0.3 GB): MEI flag.
- Writes to Supabase using `.env.local` (service role): **inserts** new CNPJs; for CNPJs already in the
  workspace it only refreshes registry fields (situação, razão social, CNAE, porte, abertura) and fills
  **empty** contact/address fields — it never overwrites what you edited. Also: the full CNAE table
  (FK of `companies.cnae_primary`), `company_sources` (source CNPJ, dataset month), niche assignment via
  `industry_cnaes`, field provenance, tags `cnpj-rfb` / `filial`, and an `imports` audit row.
- `--output file.csv` also writes a CSV (`;`, UTF-8 BOM — opens in Excel).

Fixes vs the old importer: companies **without nome fantasia are kept** (razão social is the name — this
was most small businesses); secondary CNAEs are matched; no 2,000-row upload limit; no manual download.
Legacy 8-digit mobiles in the registry get the 9th digit (ANATEL rule) so WhatsApp links work; the numbers
exactly as registered stay in `company_sources.raw_ref.phones_as_registered`.

Measured (2026-09 release, Sobral/CE, sample of 1/10 of the files): 655 active establishments, 609 with
phone, 394 with e-mail, 395 without nome fantasia. Full run ≈ 10× that. Download speed from the Receita
was ~1.7 MB/s per connection (~2 MB/s total with 4) → 45–70 min for a full run.

After syncing, the Discovery source **Banco local** returns these companies (matched by city + niche
CNAE/keywords, or everything with "Todas as empresas da cidade") and merges them with OSM results.

## Legacy: `cnpj_importer.py` + CSV upload

Still available for pre-extracted files (`--input-dir`) → CSV → Imports page. Prefer `cnpj_sync.py`.

## Rules

- Only the filtered subset is stored, never the national dataset.
- Official public data; never scrape the Receita website — always the bulk open-data files.
- The RFB layout can change between releases; column lists are at the top of `cnpj_sync.py`.
