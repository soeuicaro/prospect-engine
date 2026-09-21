import { PageHeaderSkeleton, FormCardSkeleton, ListCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <FormCardSkeleton fields={2} />
      <ListCardSkeleton rows={5} />
    </div>
  );
}
