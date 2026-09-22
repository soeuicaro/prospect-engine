import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { enrichStoredBatch } from "@/lib/discovery/batch-enrich";

export const maxDuration = 300;

/**
 * POST /api/maintenance/enrich-stored — enriches the next batch of stored
 * companies (website from e-mail domain, socials/WhatsApp from the official
 * site, Prospect Score). Call repeatedly until `remaining` is 0.
 * Body: { limit?: number (≤500), city?: string }
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: number; city?: string };
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const stats = await enrichStoredBatch(supabase, workspace, { limit: body.limit ?? 60, city: body.city ?? null, concurrency: 6 });
  return Response.json(stats);
}
