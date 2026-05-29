import { PositionCard } from "@/components/pozisyon/PositionCard";
import { PositionEmptyState } from "@/components/pozisyon/PositionEmptyState";
import { TradeTimelineCard } from "@/components/pozisyon/TradeTimelineCard";

export default function PozisyonPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <PositionCard />
      <PositionEmptyState />
      <TradeTimelineCard />
    </div>
  );
}
