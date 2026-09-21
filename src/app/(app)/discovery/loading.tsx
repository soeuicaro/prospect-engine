import { PageHeaderSkeleton, FormCardSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <FormCardSkeleton fields={4} />
      <ListCardSkeleton rows={2} title={false} />
    </div>
  );
}
