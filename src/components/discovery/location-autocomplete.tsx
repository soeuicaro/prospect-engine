"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { foldText, UF_NAMES } from "@/lib/discovery/normalize";
import { cn } from "@/lib/utils";

export interface AutocompleteOption {
  key: string;
  label: string;
  hint?: string;
}

/**
 * Text input with a filtered suggestion list (type → pick). Free text is
 * still accepted; picking an option calls `onPick`. Keyboard: ↑ ↓ Enter Esc.
 */
function Autocomplete({
  value,
  onChange,
  onPick,
  options,
  placeholder,
  loading,
  emptyText,
  maxLength,
}: {
  value: string;
  onChange: (text: string) => void;
  onPick: (option: AutocompleteOption) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  loading?: boolean;
  emptyText?: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(o: AutocompleteOption) {
    onPick(o);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        required
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || !options.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(options[Math.min(active, options.length - 1)]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (options.length > 0 || loading || emptyText) && (
        <ul ref={listRef} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full min-w-48 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {loading && <li className="px-2 py-1.5 text-xs text-muted-foreground">Carregando...</li>}
          {!loading && options.length === 0 && emptyText && <li className="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</li>}
          {options.map((o, i) => (
            <li
              key={o.key}
              data-index={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5", i === active && "bg-accent text-accent-foreground")}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UF
// ---------------------------------------------------------------------------

const UF_OPTIONS = Object.entries(UF_NAMES).map(([uf, name]) => ({ uf, name, folded: foldText(name) }));

export function StateAutocomplete({ value, onChange }: { value: string; onChange: (uf: string) => void }) {
  const options = useMemo(() => {
    const q = foldText(value);
    return UF_OPTIONS.filter((o) => !q || o.uf.toLowerCase().startsWith(q) || o.folded.includes(q)).map((o) => ({ key: o.uf, label: o.uf, hint: o.name }));
  }, [value]);
  return <Autocomplete value={value} onChange={onChange} onPick={(o) => onChange(o.key)} options={options} placeholder="CE" maxLength={20} emptyText="UF não encontrada" />;
}

// ---------------------------------------------------------------------------
// City (IBGE list, loaded once on first focus/typing)
// ---------------------------------------------------------------------------

type Municipio = { name: string; uf: string; folded: string };
let municipiosPromise: Promise<Municipio[]> | null = null;

function loadMunicipios(): Promise<Municipio[]> {
  municipiosPromise ??= fetch("/api/geo/municipios")
    .then((r) => (r.ok ? (r.json() as Promise<[string, string][]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((rows) => rows.map(([name, uf]) => ({ name, uf, folded: foldText(name) })))
    .catch((err) => {
      municipiosPromise = null; // allow a retry on next focus
      throw err;
    });
  return municipiosPromise;
}

const MAX_CITY_OPTIONS = 40;

export function CityAutocomplete({
  value,
  state,
  onChange,
  onPick,
}: {
  value: string;
  /** Current UF — narrows the list when it is a valid UF. */
  state: string;
  onChange: (city: string) => void;
  onPick: (city: string, uf: string) => void;
}) {
  const [all, setAll] = useState<Municipio[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMunicipios()
      .then((list) => alive && setAll(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const options = useMemo(() => {
    if (!all) return [];
    const q = foldText(value);
    const uf = UF_NAMES[state.trim().toUpperCase()] ? state.trim().toUpperCase() : null;
    const pool = uf ? all.filter((m) => m.uf === uf) : all;
    if (!q) return uf ? pool.slice(0, MAX_CITY_OPTIONS).map(toOption) : [];
    // Prefix matches first, then "contains".
    const starts = pool.filter((m) => m.folded.startsWith(q));
    const contains = pool.filter((m) => !m.folded.startsWith(q) && m.folded.includes(q));
    return [...starts, ...contains].slice(0, MAX_CITY_OPTIONS).map(toOption);
  }, [all, value, state]);

  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      onPick={(o) => {
        const [name, uf] = o.key.split("|");
        onPick(name, uf);
      }}
      options={options}
      placeholder="Digite a cidade..."
      loading={!all && !failed}
      emptyText={failed ? "Lista do IBGE indisponível — digite o nome" : value.trim() ? "Nenhuma cidade encontrada" : undefined}
    />
  );
}

function toOption(m: Municipio): AutocompleteOption {
  return { key: `${m.name}|${m.uf}`, label: m.name, hint: m.uf };
}
