"use client";

/**
 * USE FLOW INTELLIGENCE — CVD + VPIN + SMC + Liq pipeline.
 *
 * Okuma zinciri:
 *   tradeFeedStore (canlı trade'ler) +
 *   candleStore (1h mum'lar SMC/Liq için) +
 *   marketStore (canlı fiyat)
 *   → enrichWithFlowIntelligence()
 *   → FlowIntelligenceResult
 *
 * VPIN state'i ref'te tutulur (render'lar arası kalıcı, store'a yazılmaz).
 *
 * Sonuç: null iken "hazırlanıyor", hesap tamamlanınca FlowIntelligenceResult.
 */

import { useState, useEffect, useRef } from "react";
import type { Pair } from "@/lib/constants/pairs";
import type { FlowIntelligenceResult } from "@/lib/orderflow/flowIntelligence";
import { enrichWithFlowIntelligence } from "@/lib/orderflow/flowIntelligence";
import { useTradeFeedStore, selectTrades } from "@/lib/store/tradeFeedStore";
import { useCandleStore } from "@/lib/store/candleStore";
import { useMarketStore } from "@/lib/store/marketStore";
import { createVpinState, ingestTradesIntoVpin } from "@/lib/orderflow/vpin";
import type { VpinState } from "@/lib/orderflow/vpin";
import type { Candle as SmcCandle } from "@/lib/orderflow/smc";
import type { Candle as OkxCandle } from "@/lib/okx/candles";
import type { SignalDirection } from "@/lib/orderflow/flowVerdict";

/** okx/candles.ts Candle → smc.ts Candle */
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
  const candles1h = useCandleStore((s) => s.candles[`${pair}_1h`] ?? []);
  const livePrice = useMarketStore((s) => s.prices[pair]?.last ?? null);

  useEffect(() => {
    if (trades.length === 0 || !livePrice) return;

    // VPIN state'i güncelle (feed gelince arttırılır)
    if (!vpinRef.current) {
      vpinRef.current = createVpinState(pair);
    }
    vpinRef.current = ingestTradesIntoVpin(vpinRef.current, trades);

    const smcCandles: SmcCandle[] = candles1h.map(toSmcCandle);

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

  // pair değişirse VPIN sıfırla
  useEffect(() => {
    vpinRef.current = null;
    setResult(null);
  }, [pair]);

  return result;
}
