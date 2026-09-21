"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/shared/native-select";
import { previewImportAction, runImportAction, IMPORTABLE_FIELDS, type ImportRunResult } from "@/lib/actions/imports";

export function ImportWizard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [sampleRows, setSampleRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setHeaders(null);
    setResult(null);
  }

  function preview() {
    if (!file) {
      toast.error("Selecione um arquivo CSV.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await previewImportAction(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setHeaders(res.headers ?? []);
      setSampleRows(res.sampleRows ?? []);
      setTotalRows(res.totalRows ?? 0);

      // Auto-guess mapping by matching header names to field keys.
      const guessed: Record<string, string> = {};
      for (const h of res.headers ?? []) {
        const normalized = h.toLowerCase().trim();
        const field = IMPORTABLE_FIELDS.find(
          (f) => f.key === normalized || normalized.includes(f.key.replace("_", ""))
        );
        guessed[h] = field?.key ?? "__skip__";
      }
      setMapping(guessed);
    });
  }

  function runImport() {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(mapping));
    startTransition(async () => {
      const res = await runImportAction(fd);
      if (res.error) toast.error(res.error);
      else {
        setResult(res);
        toast.success(`Import concluído: ${res.created} criadas.`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="max-w-xs" />
        <Button variant="outline" onClick={preview} disabled={!file || pending}>
          {pending ? "Lendo..." : "Analisar arquivo"}
        </Button>
      </div>

      {headers && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{totalRows} linha(s) detectada(s). Mapeie as colunas:</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {headers.map((h) => (
              <div key={h} className="space-y-1">
                <label className="text-xs font-medium">{h}</label>
                <NativeSelect
                  value={mapping[h] ?? "__skip__"}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [h]: e.target.value }))}
                  className="w-full"
                >
                  <option value="__skip__">Ignorar coluna</option>
                  {IMPORTABLE_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>

          {sampleRows.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="p-2 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, i) => (
                    <tr key={i} className="border-t">
                      {headers.map((h) => (
                        <td key={h} className="p-2 text-muted-foreground">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Button onClick={runImport} disabled={pending}>
            {pending ? "Importando..." : `Importar ${totalRows} empresa(s)`}
          </Button>
        </div>
      )}

      {result && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p>{result.created} criadas · {result.duplicates} duplicadas (ignoradas) · {result.errors} erros</p>
        </div>
      )}
    </div>
  );
}
