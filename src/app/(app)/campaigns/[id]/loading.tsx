import { PageHeaderSkeleton, StatCardsSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={4} />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
      <Skeleton className="h-9 w-40" />
      <ListCardSkeleton rows={6} />
    </div>
  );
}
