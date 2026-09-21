import { requireWorkspace } from "@/lib/workspace";
import { getPipelineBoard } from "@/lib/queries/pipeline";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";

export default async function PipelinePage() {
  const workspace = await requireWorkspace();
  const { stages, cards } = await getPipelineBoard(workspace.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted-foreground">Arraste os cards entre as etapas do funil.</p>
      </div>
      <PipelineBoard stages={stages} initialCards={cards} />
    </div>
  );
}
