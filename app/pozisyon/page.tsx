"use client";

import { usePositionStore } from "@/lib/store/positionStore";
import { useTradesStore } from "@/lib/store/tradesStore";
import { PositionCard } from "@/components/pozisyon/PositionCard";
import { PositionEmptyState } from "@/components/pozisyon/PositionEmptyState";
import { TradeTimelineCard } from "@/components/pozisyon/TradeTimelineCard";

export default function PozisyonPage() {
  const positions = usePositionStore((s) => s.positions);
  const closingInstId = usePositionStore((s) => s.closingInstId);
  const setClosingInstId = usePositionStore((s) => s.setClosingInstId);
  const removePosition = usePositionStore((s) => s.removePosition);
  const trades = useTradesStore((s) => s.trades);

  async function handleClose(instId: string) {
    setClosingInstId(instId);
    try {
      const res = await fetch("/api/okx/api/v5/trade/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isDemo: false,
          body: { instId, mgnMode: "cross" },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        removePosition(instId);
      }
    } finally {
      setClosingInstId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {positions.length === 0 ? (
        <PositionEmptyState />
      ) : (
        positions.map((pos) => (
          <PositionCard
            key={pos.instId}
            position={pos}
            onClose={() => handleClose(pos.instId)}
            isClosing={closingInstId === pos.instId}
          />
        ))
      )}
      <TradeTimelineCard trades={trades} limit={10} />
    </div>
  );
}
