import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { listIndustries } from "@/lib/queries/industries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewOfferForm } from "./new-offer-form";
import { OfferToggle } from "@/components/offers/offer-toggle";

export default async function OffersPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const [industries, { data: offers }] = await Promise.all([
    listIndustries(workspace.id),
    supabase
      .from("offers")
      .select("id, name, description, offer_type, ticket_min, ticket_max, active, industries(name)")
      .eq("workspace_id", workspace.id)
      .order("name"),
  ]);

  type Row = {
    id: string;
    name: string;
    description: string | null;
    offer_type: string;
    ticket_min: number | null;
    ticket_max: number | null;
    active: boolean;
    industries: { name: string } | { name: string }[] | null;
  };
  const rows = (offers ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ofertas</h1>
        <p className="text-sm text-muted-foreground">
          Ticket interno — nunca mostrado automaticamente ao prospect na primeira mensagem.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova oferta</CardTitle>
        </CardHeader>
        <CardContent>
          <NewOfferForm industries={industries} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((o) => {
          const industry = Array.isArray(o.industries) ? o.industries[0] : o.industries;
          return (
            <Card key={o.id} className={!o.active ? "opacity-60" : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{o.name}</CardTitle>
                  <Badge variant="outline">{o.offer_type === "recurring" ? "Recorrente" : "Pontual"}</Badge>
                </div>
                {industry && <p className="text-xs text-muted-foreground">{industry.name}</p>}
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{o.description}</p>
                {(o.ticket_min || o.ticket_max) && (
                  <p className="text-xs text-muted-foreground">
                    Ticket interno: R$ {o.ticket_min ?? "?"} – R$ {o.ticket_max ?? "?"}
                  </p>
                )}
                <OfferToggle offerId={o.id} active={o.active} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
