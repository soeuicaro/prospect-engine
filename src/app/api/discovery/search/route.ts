import { createClient } from "@/lib/supabase/server";
import { requireUser, requireWorkspace } from "@/lib/workspace";
import { SearchValidationError } from "@/lib/discovery/context";
import { executeSearch } from "@/lib/discovery/service";
import type { SearchStreamEvent, SourceKey } from "@/lib/discovery/types";

// Longest search depth (DEEP) has a 55s deadline; leave headroom for merge/persist.
export const maxDuration = 90;

/**
 * POST /api/discovery/search — runs one discovery search and streams
 * progress as NDJSON (one SearchStreamEvent per line): phases, per-source
 * completion, running counts, then `done` with the full SearchResponse.
 * Closing the connection (client "Cancelar") aborts in-flight source
 * requests via request.signal; partial results are still persisted.
 *
 * Body: { context: SearchContext-like, refresh?: "none" | "all" | { source, searchId } }
 */
export async function POST(request: Request) {
  let body: { context?: unknown; refresh?: "none" | "all" | { source: SourceKey; searchId: string } };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const [workspace, user] = await Promise.all([requireWorkspace(), requireUser()]);
  const supabase = await createClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        const response = await executeSearch({
          supabase,
          workspace,
          userId: user.id,
          rawContext: body.context,
          refresh: body.refresh ?? "none",
          emit: send,
          signal: request.signal,
        });
        send({ type: "done", response });
      } catch (err) {
        const message =
          err instanceof SearchValidationError
            ? err.message
            : "Não foi possível realizar a busca agora. Tente novamente ou veja o status das fontes.";
        if (!(err instanceof SearchValidationError)) console.error("[discovery] search failed", err);
        send({ type: "error", message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by client abort
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
