import { VerdictBadge } from "@/components/karar/VerdictBadge";
import { ScoreBar } from "@/components/karar/ScoreBar";
import { ScoreBreakdown } from "@/components/karar/ScoreBreakdown";
import { BlocksList } from "@/components/karar/BlocksList";
import { ReasonsList } from "@/components/karar/ReasonsList";
import { DirectionBadge } from "@/components/karar/DirectionBadge";
import { FlowAlignmentRow } from "@/components/karar/FlowAlignmentRow";

export default function KararPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <VerdictBadge />
      <DirectionBadge />
      <ScoreBar />
      <FlowAlignmentRow />
      <ScoreBreakdown />
      <BlocksList />
      <ReasonsList />
    </div>
  );
}
