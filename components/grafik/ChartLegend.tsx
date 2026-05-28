"use client";

/**
 * CHART LEGEND — Renk açıklamaları.
 */

import { useT } from "@/lib/i18n/context";

interface Props {
  showEma20: boolean;
  showEma50: boolean;
  showTrades: boolean;
}

export function ChartLegend({
  showEma20,
  showEma50,
  showTrades,
}: Props): React.ReactElement {
  const t = useT();

  return (
    <div className="border-border bg-bg-card flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 font-mono text-2xs tracking-wider">
      <LegendDot color="#22c55e" label={t("grafik.legend.candleUp")} />
      <LegendDot color="#ef4444" label={t("grafik.legend.candleDown")} />
      {showEma20 && <LegendDot color="#3b82f6" label={t("grafik.legend.ema20")} />}
      {showEma50 && <LegendDot color="#f59e0b" label={t("grafik.legend.ema50")} />}
      {showTrades && (
        <>
          <LegendArrow up label={t("grafik.legend.tradeLong")} />
          <LegendArrow up={false} label={t("grafik.legend.tradeShort")} />
        </>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-2 w-4 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-text-t3">{label}</span>
    </div>
  );
}

function LegendArrow({ up, label }: { up: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-t1 font-bold">{up ? "▲" : "▼"}</span>
      <span className="text-text-t3">{label}</span>
    </div>
  );
}
