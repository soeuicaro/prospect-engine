import { PageHeaderSkeleton, BoardSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <BoardSkeleton />
    </div>
  );
}
