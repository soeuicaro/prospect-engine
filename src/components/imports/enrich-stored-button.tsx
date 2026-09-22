"use client";

import { useRef, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { BatchStats } from "@/lib/discovery/batch-enrich";

/** Runs /api/maintenance/enrich-stored in batches until the whole base is done. */
export function EnrichStoredButton({ pending }: { pending: number }) {
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState<BatchStats | null>(null);
  const [remaining, setRemaining] = useState(pending);
  const stop = useRef(false);

  async function run() {
    setRunning(true);
    stop.current = false;
    const start = remaining;
    let acc: BatchStats = { processed: 0, websitesFound: 0, websitesChecked: 0, socialsFound: 0, whatsappFound: 0, emailsFound: 0, remaining, errors: 0 };
    while (!stop.current) {
      const res = await fetch("/api/maintenance/enrich-stored", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 60 }) });
      if (!res.ok) break;
      const s = (await res.json()) as BatchStats;
      acc = {
        processed: acc.processed + s.processed,
        websitesFound: acc.websitesFound + s.websitesFound,
        websitesChecked: acc.websitesChecked + s.websitesChecked,
        socialsFound: acc.socialsFound + s.socialsFound,
        whatsappFound: acc.whatsappFound + s.whatsappFound,
        emailsFound: acc.emailsFound + s.emailsFound,
        errors: acc.errors + s.errors,
        remaining: s.remaining,
      };
      setTotal(acc);
      setRemaining(s.remaining);
      if (s.remaining === 0 || s.processed === 0) break;
    }
    setRunning(false);
    void start;
  }

  const done = pending + (total?.processed ?? 0) > 0 ? ((total?.processed ?? 0) / Math.max(1, (total?.processed ?? 0) + remaining)) * 100 : 100;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button size="sm" variant="outline" onClick={() => (stop.current = true)}>
            <Loader2 className="size-3.5 animate-spin" /> Pausar
          </Button>
        ) : (
          <Button size="sm" onClick={() => void run()} disabled={remaining === 0}>
            <Wand2 className="size-3.5" /> Enriquecer base ({remaining} pendentes)
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Site pelo domínio do e-mail · redes/WhatsApp do site oficial · Prospect Score</span>
      </div>
      {total && (
        <>
          <Progress value={done} />
          <p className="text-xs text-muted-foreground">
            {total.processed} processadas · {total.websitesFound} sites descobertos ({total.websitesChecked} verificados) · {total.socialsFound} redes sociais ·{" "}
            {total.whatsappFound} WhatsApp · {total.emailsFound} e-mails · {remaining} restantes
          </p>
        </>
      )}
    </div>
  );
}
