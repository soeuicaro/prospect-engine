import { PageHeaderSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <ListCardSkeleton rows={8} />
    </div>
  );
}
