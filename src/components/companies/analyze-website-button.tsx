"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyzeWebsiteAction } from "@/lib/actions/analysis";

export function AnalyzeWebsiteButton({ companyId, hasWebsite }: { companyId: string; hasWebsite: boolean }) {
  const [pending, startTransition] = useTransition();

  if (!hasWebsite) {
    return <p className="text-xs text-muted-foreground">Sem website cadastrado para analisar.</p>;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await analyzeWebsiteAction(companyId);
          if (res.error) toast.error(res.error);
          else toast.success("Site analisado. Sinais e score atualizados.");
        })
      }
    >
      <Globe className="mr-2 h-3.5 w-3.5" />
      {pending ? "Analisando..." : "Analisar site"}
    </Button>
  );
}
