"use client";

/**
 * USE FLOW INTELLIGENCE — CVD + VPIN + SMC + Liq pipeline.
 *
 * useMemo mimarisi:
 *   useState+useEffect yerine useMemo kullanılır. Bu, setResult → re-render →
 *   trades değişti → effect tetiklendi → setResult döngüsünü tamamen ortadan kaldırır.
 *   Sonuç render sırasında senkron hesaplanır, ek render tetiklenmez.
 *
 * VPIN: Her hesaplamada sıfırdan oluşturulur (idempotent, StrictMode uyumlu).
 */

import { useMemo } from "react";
import type { Pair } from "@/lib/constants/pairs";
import type { FlowIntelligenceResult } from "@/lib/orderflow/flowIntelligence";
import { enrichWithFlowIntelligence } from "@/lib/orderflow/flowIntelligence";
import { useTradeFeedStore, selectTrades } from "@/lib/store/tradeFeedStore";
import { useCandleStore, EMPTY_CANDLES } from "@/lib/store/candleStore";
import { useMarketStore } from "@/lib/store/marketStore";
import { createVpinState, ingestTradesIntoVpin } from "@/lib/orderflow/vpin";
import type { Candle as SmcCandle } from "@/lib/orderflow/smc";
import type { Candle as OkxCandle } from "@/lib/okx/candles";
import type { SignalDirection } from "@/lib/orderflow/flowVerdict";

function toSmcCandle(c: OkxCandle): SmcCandle {
  return { time: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

export function useFlowIntelligence(
  pair: Pair,
  signalDirection: SignalDirection,
): FlowIntelligenceResult | null {
  const trades = useTradeFeedStore(selectTrades(pair));
  const candles1hRaw = useCandleStore((s) => s.candles[`${pair}_1h`]);
  const candles1h = candles1hRaw ?? EMPTY_CANDLES;
  const livePrice = useMarketStore((s) => s.prices[pair]?.last ?? null);

  return useMemo(() => {
    if (trades.length === 0 || !livePrice) return null;

    // VPIN sıfırdan hesaplanır — her useMemo çalışmasında fresh state
    const vpinState = ingestTradesIntoVpin(createVpinState(pair), trades);
    const smcCandles: SmcCandle[] = (candles1h as OkxCandle[]).map(toSmcCandle);

    return enrichWithFlowIntelligence(
      pair,
      signalDirection,
      trades,
      smcCandles,
      livePrice,
      vpinState,
      Date.now(),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, signalDirection, trades, candles1h, livePrice]);
}
