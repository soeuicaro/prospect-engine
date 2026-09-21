import { PageHeaderSkeleton, TableSkeleton } from "@/components/shared/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-20" />
      </div>
      <TableSkeleton rows={10} />
    </div>
  );
}
