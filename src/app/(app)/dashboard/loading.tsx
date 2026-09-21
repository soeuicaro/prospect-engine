import { PageHeaderSkeleton, StatCardsSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={9} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCardsSkeleton count={3} />
      </div>
      <ListCardSkeleton rows={6} />
    </div>
  );
}
