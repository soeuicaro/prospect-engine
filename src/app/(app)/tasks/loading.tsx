import { PageHeaderSkeleton, FormCardSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <FormCardSkeleton fields={3} />
      <div className="grid gap-6 md:grid-cols-2">
        <ListCardSkeleton rows={4} />
        <ListCardSkeleton rows={4} />
      </div>
    </div>
  );
}
