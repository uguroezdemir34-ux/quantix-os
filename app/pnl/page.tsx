"use client";

import { useTradesStore } from "@/lib/store/tradesStore";
import { PnlStatsCard } from "@/components/pnl/PnlStatsCard";
import { PnlSummaryRow } from "@/components/pnl/PnlSummaryRow";
import { PnlCalendar } from "@/components/pnl/PnlCalendar";
import { computePnlStats } from "@/lib/pnl/stats";
import { computeDailyAggregates } from "@/lib/pnl/compute";
import type { TradeRecord } from "@/lib/pnl/types";

export default function PnlPage() {
  const snapshots = useTradesStore((s) => s.trades);

  const trades: TradeRecord[] = snapshots
    .filter((t) => t.status === "closed" && t.exit != null)
    .map((t) => ({
      closedAt: t.exit!.closedAt,
      openedAt: t.openedAt,
      pair: t.pair,
      direction: t.direction,
      pnlUsd: t.exit!.pnlUsd,
      pnlPct: t.exit!.pnlPct,
      score: t.entryContext.score,
      closeReason: t.exit!.reason,
      isPaper: t.isPaper,
    }));

  const stats = computePnlStats(trades);
  const aggregates = computeDailyAggregates(trades);
  const maxAbsPnl = aggregates.reduce(
    (m, d) => Math.max(m, Math.abs(d.totalPnlUsd)),
    0
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <PnlSummaryRow trades={trades} />
      <PnlStatsCard stats={stats} />
      <PnlCalendar aggregates={aggregates} maxAbsPnl={maxAbsPnl} />
    </div>
  );
}
