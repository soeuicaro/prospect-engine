import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { listCompanies } from "@/lib/queries/companies";
import { listIndustries, listPipelineStages } from "@/lib/queries/industries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { CompaniesTable } from "@/components/companies/companies-table";
import { Building2, Plus } from "lucide-react";
import { NativeSelect } from "@/components/shared/native-select";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const workspace = await requireWorkspace();
  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;

  const [industries, stages, { rows, total, pageSize }] = await Promise.all([
    listIndustries(workspace.id),
    listPipelineStages(workspace.id),
    listCompanies(workspace.id, {
      search: params.q,
      industryId: params.industry && params.industry !== "all" ? params.industry : undefined,
      stageId: params.stage && params.stage !== "all" ? params.stage : undefined,
      city: params.city,
      noWebsite: params.no_website === "1",
      sortBy: (params.sort as "score" | "created_at" | "name") ?? "created_at",
      sortDir: (params.dir as "asc" | "desc") ?? "desc",
      page,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground">{total} empresa(s) no workspace</p>
        </div>
        <Button asChild>
          <Link href="/companies/new">
            <Plus className="mr-2 h-4 w-4" /> Nova empresa
          </Link>
        </Button>
      </div>

      <form className="flex flex-wrap items-center gap-2" action="/companies" method="get">
        <Input
          name="q"
          placeholder="Buscar por nome, razão social ou CNPJ..."
          defaultValue={params.q}
          className="w-64"
        />
        <Input name="city" placeholder="Cidade" defaultValue={params.city} className="w-40" />
        <NativeSelect name="industry" defaultValue={params.industry ?? "all"} className="w-44">
          <option value="all">Todos os nichos</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="stage" defaultValue={params.stage ?? "all"} className="w-44">
          <option value="all">Todas as etapas</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Você ainda não possui prospects"
          description="Crie sua primeira empresa manualmente ou importe uma lista via CSV/CNPJ para começar a priorizar oportunidades."
          actionLabel="Criar minha primeira busca"
          actionHref="/imports"
        />
      ) : (
        <>
          <CompaniesTable rows={rows} stages={stages} />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
                {page > 1 ? (
                  <Link href={buildPageLink(params, page - 1)}>Anterior</Link>
                ) : (
                  <span>Anterior</span>
                )}
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
                {page < totalPages ? (
                  <Link href={buildPageLink(params, page + 1)}>Próxima</Link>
                ) : (
                  <span>Próxima</span>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buildPageLink(params: Record<string, string | undefined>, page: number) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") sp.set(key, value);
  }
  sp.set("page", String(page));
  return `/companies?${sp.toString()}`;
}
