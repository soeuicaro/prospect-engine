import { PageHeaderSkeleton, CardGridSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withAction />
      <CardGridSkeleton count={6} />
    </div>
  );
}
