import { PageHeaderSkeleton, CardGridSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <CardGridSkeleton count={4} columns="md:grid-cols-2" />
    </div>
  );
}
