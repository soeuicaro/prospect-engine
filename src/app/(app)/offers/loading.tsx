import { PageHeaderSkeleton, FormCardSkeleton, CardGridSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <FormCardSkeleton fields={3} />
      <CardGridSkeleton count={6} />
    </div>
  );
}
