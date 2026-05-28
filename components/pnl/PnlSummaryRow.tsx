"use client";

/**
 * PNL SUMMARY ROW — Bu hafta + bu ay + tüm zaman özeti.
 *
 * Üst sıraya konur — 3 stat kart yan yana.
 */

import { useT } from "@/lib/i18n/context";
import type { TradeRecord } from "@/lib/pnl/types";
import { filterLastNDays, computePnlStats } from "@/lib/pnl/stats";

interface Props {
  trades: TradeRecord[];
}

export function PnlSummaryRow({ trades }: Props): React.ReactElement {
  const t = useT();
  const now = Date.now();

  const thisWeek = filterLastNDays(trades, 7, now);
  const thisMonth = filterLastNDays(trades, 30, now);

  const weekStats = computePnlStats(thisWeek);
  const monthStats = computePnlStats(thisMonth);
  const allStats = computePnlStats(trades);

  return (
    <div className="grid grid-cols-3 gap-2">
      <SummaryCell
        label={t("pnl.summary.thisWeek")}
        pnl={weekStats.totalPnlUsd}
        count={weekStats.totalTrades}
      />
      <SummaryCell
        label={t("pnl.summary.thisMonth")}
        pnl={monthStats.totalPnlUsd}
        count={monthStats.totalTrades}
      />
      <SummaryCell
        label={t("pnl.summary.allTime")}
        pnl={allStats.totalPnlUsd}
        count={allStats.totalTrades}
      />
    </div>
  );
}

function SummaryCell({
  label,
  pnl,
  count,
}: {
  label: string;
  pnl: number;
  count: number;
}) {
  const color =
    pnl > 0 ? "text-signal-green" : pnl < 0 ? "text-signal-red" : "text-text-t2";
  const sign = pnl >= 0 ? "+" : "";
  return (
    <div className="border-border bg-bg-card rounded-md border p-2">
      <div className="text-text-t3 font-mono text-2xs tracking-wider">
        {label}
      </div>
      <div className={`font-mono text-sm font-bold tabular-nums ${color}`}>
        {sign}${pnl.toFixed(2)}
      </div>
      <div className="text-text-t4 font-mono text-2xs tracking-wider">
        {count}
      </div>
    </div>
  );
}
