/**
 * CANDLE POLLER — Her pair + timeframe için mum verisini periyodik çeker.
 *
 * - İlk yüklemede hemen çeker
 * - Sonra her 30s'de bir günceller
 * - candleStore'u günceller
 */

"use client";

import { useEffect, useRef } from "react";
import { PAIRS } from "@/lib/constants/pairs";
import { fetchCandles, type Timeframe } from "@/lib/okx/candles";
import { useCandleStore } from "@/lib/store/candleStore";

const TIMEFRAMES: Timeframe[] = ["4h", "1h", "15m"];
const TIMEFRAMES_1D: Timeframe[] = ["1d"];
const POLL_INTERVAL_MS = 30_000;
const CANDLE_LIMIT = 210;
const CANDLE_LIMIT_1D = 60;

export function useCandlePoller(): void {
  const setCandles = useCandleStore((s) => s.setCandles);
  const setError = useCandleStore((s) => s.setError);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchAll(): Promise<void> {
    await Promise.all(
      PAIRS.flatMap((pair) => [
        ...TIMEFRAMES.map(async (tf) => {
          const candles = await fetchCandles(pair, tf, CANDLE_LIMIT);
          if (candles) {
            setCandles(pair, tf, candles, Date.now());
          } else {
            setError(pair, tf, "fetch_failed");
          }
        }),
        ...TIMEFRAMES_1D.map(async (tf) => {
          const candles = await fetchCandles(pair, tf, CANDLE_LIMIT_1D);
          if (candles) {
            setCandles(pair, tf, candles, Date.now());
          } else {
            setError(pair, tf, "fetch_failed");
          }
        }),
      ]),
    );
  }

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}
