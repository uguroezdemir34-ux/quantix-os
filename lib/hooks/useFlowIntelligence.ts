"use client";

/**
 * USE FLOW INTELLIGENCE — CVD + VPIN + SMC + Liq pipeline.
 *
 * Stable referans kuralı:
 *   useCandleStore selector'ı EMPTY_CANDLES sabitini fallback olarak kullanır.
 *   Bu sayede candle verisi yokken her render'da yeni [] üretilmez → döngü yok.
 */

import { useState, useEffect, useRef } from "react";
import type { Pair } from "@/lib/constants/pairs";
import type { FlowIntelligenceResult } from "@/lib/orderflow/flowIntelligence";
import { enrichWithFlowIntelligence } from "@/lib/orderflow/flowIntelligence";
import { useTradeFeedStore, selectTrades } from "@/lib/store/tradeFeedStore";
import { useCandleStore, EMPTY_CANDLES } from "@/lib/store/candleStore";
import { useMarketStore } from "@/lib/store/marketStore";
import { createVpinState, ingestTradesIntoVpin } from "@/lib/orderflow/vpin";
import type { VpinState } from "@/lib/orderflow/vpin";
import type { Candle as SmcCandle } from "@/lib/orderflow/smc";
import type { Candle as OkxCandle } from "@/lib/okx/candles";
import type { SignalDirection } from "@/lib/orderflow/flowVerdict";

function toSmcCandle(c: OkxCandle): SmcCandle {
  return {
    time: c.ts,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  };
}

export function useFlowIntelligence(
  pair: Pair,
  signalDirection: SignalDirection,
): FlowIntelligenceResult | null {
  const [result, setResult] = useState<FlowIntelligenceResult | null>(null);
  const vpinRef = useRef<VpinState | null>(null);

  const trades = useTradeFeedStore(selectTrades(pair));

  // EMPTY_CANDLES: module-level frozen array — undefined durumunda her render'da
  // yeni [] üretmez, stable referans döndürür → useEffect döngüsünü kırar
  const candles1hRaw = useCandleStore((s) => s.candles[`${pair}_1h`]);
  const candles1h = candles1hRaw ?? EMPTY_CANDLES;

  const livePrice = useMarketStore((s) => s.prices[pair]?.last ?? null);

  useEffect(() => {
    if (trades.length === 0 || !livePrice) return;

    if (!vpinRef.current) {
      vpinRef.current = createVpinState(pair);
    }
    vpinRef.current = ingestTradesIntoVpin(vpinRef.current, trades);

    const smcCandles: SmcCandle[] = (candles1h as OkxCandle[]).map(toSmcCandle);

    const flowResult = enrichWithFlowIntelligence(
      pair,
      signalDirection,
      trades,
      smcCandles,
      livePrice,
      vpinRef.current,
      Date.now(),
    );

    setResult(flowResult);
  }, [pair, signalDirection, trades, candles1h, livePrice]);

  useEffect(() => {
    vpinRef.current = null;
    setResult(null);
  }, [pair]);

  return result;
}
