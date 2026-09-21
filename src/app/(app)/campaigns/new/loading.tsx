import { PageHeaderSkeleton, FormCardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeaderSkeleton />
      <FormCardSkeleton fields={5} />
    </div>
  );
}
