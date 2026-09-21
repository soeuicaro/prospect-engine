import { PageHeaderSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-6 md:grid-cols-3">
        <ListCardSkeleton rows={3} />
        <ListCardSkeleton rows={3} />
        <ListCardSkeleton rows={3} />
      </div>
    </div>
  );
}
