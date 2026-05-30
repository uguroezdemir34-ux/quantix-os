"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useCandleStore, EMPTY_CANDLES } from "@/lib/store/candleStore";
import { useTradesStore } from "@/lib/store/tradesStore";
import { ChartControls } from "@/components/grafik/ChartControls";
import { ChartLegend } from "@/components/grafik/ChartLegend";
import { emaSeries } from "@/lib/indicators/ema";
import type { Pair } from "@/lib/constants/pairs";
import type { Timeframe } from "@/lib/okx/candles";
import type { ChartSeries, LinePoint, ChartMarker } from "@/lib/chart/types";

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

  const candlesRaw = useCandleStore((s) => s.candles[`${pair}_${timeframe}`]);
  const candles = candlesRaw ?? EMPTY_CANDLES;
  const trades = useTradesStore((s) => s.trades);

  const series: ChartSeries = useMemo(() => {
    const candlePoints = candles.map((c) => ({
      time: Math.floor(c.ts / 1000) as unknown as number,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const closes = candles.map((c) => c.close);
    const times = candles.map((c) => Math.floor(c.ts / 1000));

    // EMA overlays
    let ema20: LinePoint[] | undefined;
    let ema50: LinePoint[] | undefined;

    if (showEma20 && candles.length >= 20) {
      const vals = emaSeries(closes, { period: 20 });
      ema20 = vals
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter((p): p is LinePoint => p !== null);
    }

    if (showEma50 && candles.length >= 50) {
      const vals = emaSeries(closes, { period: 50 });
      ema50 = vals
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter((p): p is LinePoint => p !== null);
    }

    // Trade markers — bu pair'in trade'leri
    let markers: ChartMarker[] | undefined;
    if (showTrades) {
      const pairTrades = trades.filter((t) => t.pair === pair);
      markers = pairTrades.map((t) => ({
        time: Math.floor(t.openedAt / 1000),
        position: t.direction === "LONG" ? "belowBar" : "aboveBar",
        color: t.direction === "LONG" ? "#22c55e" : "#ef4444",
        shape: t.direction === "LONG" ? "arrowUp" : "arrowDown",
        text: `${t.direction} ${t.isPaper ? "(P)" : ""}`,
      }));
    }

    return { candles: candlePoints, ema20, ema50, markers };
  }, [candles, trades, pair, showEma20, showEma50, showTrades]);

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
