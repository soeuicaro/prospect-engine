import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches the `<h1 className="text-2xl ..."><p className="text-sm ...">` header every page starts with. */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      {withAction && <Skeleton className="h-9 w-36" />}
    </div>
  );
}

/** Matches the stat-card grids used on the dashboard and detail pages. */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-3 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-12" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Matches a Card with a title and a handful of list rows (followups, tasks, suppression, imports). */
export function ListCardSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <Card>
      {title && (
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Matches a table with a header row and striped rows (companies list). */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b pb-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="ml-auto h-5 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Matches the campaigns/offers/templates/playbooks grid-of-cards layout. */
export function CardGridSkeleton({ count = 6, columns = "md:grid-cols-2 lg:grid-cols-3" }: { count?: number; columns?: string }) {
  return (
    <div className={`grid gap-4 ${columns}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Matches a single centered form card (new company, discovery search, new template/offer). */
export function FormCardSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-32" />
      </CardContent>
    </Card>
  );
}

/** Matches the kanban board on /pipeline. */
export function BoardSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="w-72 shrink-0 space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="space-y-2 rounded-md bg-muted/30 p-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-16 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Matches the two-column company detail page. */
export function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <StatCardsSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-28" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Matches the /settings tabbed page. */
export function TabsPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
