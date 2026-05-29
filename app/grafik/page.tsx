"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useCandleStore } from "@/lib/store/candleStore";
import { ChartControls } from "@/components/grafik/ChartControls";
import { ChartLegend } from "@/components/grafik/ChartLegend";
import type { Pair } from "@/lib/constants/pairs";
import type { Timeframe } from "@/lib/okx/candles";
import type { ChartSeries } from "@/lib/chart/types";

const PriceChart = dynamic(
  () => import("@/components/grafik/PriceChart").then((m) => m.PriceChart),
  { ssr: false },
);

export default function GrafikPage() {
  const [pair, setPair] = useState<Pair>("BTC");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showTrades, setShowTrades] = useState(false);

  const candles = useCandleStore((s) => s.candles[`${pair}_${timeframe}`] ?? []);

  const series: ChartSeries = {
    candles: candles.map((c) => ({
      time: Math.floor(c.ts / 1000) as unknown as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })),
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartControls
        pair={pair}
        timeframe={timeframe}
        showEma20={showEma20}
        showEma50={showEma50}
        showTrades={showTrades}
        onPairChange={setPair}
        onTimeframeChange={setTimeframe}
        onToggleEma20={() => setShowEma20((v) => !v)}
        onToggleEma50={() => setShowEma50((v) => !v)}
        onToggleTrades={() => setShowTrades((v) => !v)}
      />
      <ChartLegend
        showEma20={showEma20}
        showEma50={showEma50}
        showTrades={showTrades}
      />
      <PriceChart series={series} height={420} />
    </div>
  );
}
