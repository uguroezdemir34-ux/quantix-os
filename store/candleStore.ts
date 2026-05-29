/**
 * CANDLE STORE — Mum verisi state.
 *
 * Yapı:
 *   candles[pair][timeframe] → Candle[]
 *   lastFetchedAt[pair][timeframe] → ms
 *
 * Polling katmanı (useCandleStream) her 30s'de bir fetch eder, store'u
 * günceller. Skor pipeline buradan okur.
 */

import { create } from "zustand";
import type { Pair } from "@/lib/constants/pairs";
import type { Candle, Timeframe } from "@/lib/okx/candles";

type PairTfKey = `${Pair}_${Timeframe}`;

interface CandleStoreState {
  /** Anahtar: "BTC_4h", "ETH_1h", vs. */
  candles: Partial<Record<PairTfKey, Candle[]>>;
  /** Son fetch zamanı (epoch ms) */
  lastFetchedAt: Partial<Record<PairTfKey, number>>;
  /** Hata durumları (fetch fail) */
  lastError: Partial<Record<PairTfKey, string>>;

  // Actions
  setCandles: (pair: Pair, tf: Timeframe, candles: Candle[], now: number) => void;
  setError: (pair: Pair, tf: Timeframe, err: string) => void;
  /** Live ticker fiyatıyla son mumun close değerini güncelle (tick'te) */
  updateLastClose: (pair: Pair, tf: Timeframe, close: number) => void;
  reset: () => void;
}

const keyOf = (pair: Pair, tf: Timeframe): PairTfKey =>
  `${pair}_${tf}` as PairTfKey;

export const useCandleStore = create<CandleStoreState>((set) => ({
  candles: {},
  lastFetchedAt: {},
  lastError: {},

  setCandles: (pair, tf, candles, now) =>
    set((s) => ({
      candles: { ...s.candles, [keyOf(pair, tf)]: candles },
      lastFetchedAt: { ...s.lastFetchedAt, [keyOf(pair, tf)]: now },
      lastError: { ...s.lastError, [keyOf(pair, tf)]: "" },
    })),

  setError: (pair, tf, err) =>
    set((s) => ({
      lastError: { ...s.lastError, [keyOf(pair, tf)]: err },
    })),

  updateLastClose: (pair, tf, close) =>
    set((s) => {
      const key = keyOf(pair, tf);
      const arr = s.candles[key];
      if (!arr || arr.length === 0) return s;
      // Son mum (en yeni) close'unu güncelle (canlı tick için)
      const lastIdx = arr.length - 1;
      const last = arr[lastIdx];
      if (last.close === close) return s; // değişmediyse no-op
      const updated = [
        ...arr.slice(0, lastIdx),
        { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) },
      ];
      return {
        candles: { ...s.candles, [key]: updated },
      };
    }),

  reset: () => set({ candles: {}, lastFetchedAt: {}, lastError: {} }),
}));

// ═══════════════ SELECTOR'LAR ═══════════════

export const selectCandles =
  (pair: Pair, tf: Timeframe) =>
  (s: CandleStoreState): Candle[] | undefined =>
    s.candles[keyOf(pair, tf)];

export const selectLastClose =
  (pair: Pair, tf: Timeframe) =>
  (s: CandleStoreState): number | undefined => {
    const arr = s.candles[keyOf(pair, tf)];
    return arr && arr.length > 0 ? arr[arr.length - 1].close : undefined;
  };

export const selectHasFreshCandles =
  (pair: Pair, tf: Timeframe, maxAgeMs: number, now: number) =>
  (s: CandleStoreState): boolean => {
    const ts = s.lastFetchedAt[keyOf(pair, tf)];
    if (!ts) return false;
    return now - ts < maxAgeMs;
  };
