"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Catches any uncaught error from a page/layout under here (everything
 * except the root layout itself — see global-error.tsx for that) and shows
 * this instead of Next's generic built-in error screen. There was no
 * error.tsx at all before, so any unhandled exception — most commonly a
 * missing/wrong Supabase env var on whatever this is deployed to — showed
 * up as a bare "This page couldn't load" with no way to retry in place.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle className="text-xl">Algo deu errado</CardTitle>
          <CardDescription>
            Essa página não carregou. Na maioria das vezes isso é uma configuração ausente (ex.:
            variáveis do Supabase não definidas neste ambiente) — confira os logs do servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.digest && (
            <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              Digest: {error.digest}
            </p>
          )}
          <Button onClick={() => retry()} className="w-full">
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
