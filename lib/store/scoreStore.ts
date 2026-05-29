/**
 * SCORE STORE — Score engine sonuçlarını tutar.
 *
 * Her pair için en son ScoreResult saklanır.
 * useScoreEngine hook'u candleStore + diğer store'ları okuyarak
 * bu store'u günceller.
 */

import { create } from "zustand";
import type { ScoreResult } from "@/lib/score/orchestrator";
import type { Pair } from "@/lib/constants/pairs";

interface ScoreStoreState {
  /** Son hesaplanan score sonucu (pair başına) */
  results: Partial<Record<Pair, ScoreResult>>;
  /** Hesaplama zamanı */
  computedAt: Partial<Record<Pair, number>>;
  /** Hesaplama devam ediyor mu */
  computing: boolean;

  setResult: (pair: Pair, result: ScoreResult, now: number) => void;
  setComputing: (v: boolean) => void;
  reset: () => void;
}

export const useScoreStore = create<ScoreStoreState>((set) => ({
  results: {},
  computedAt: {},
  computing: false,

  setResult: (pair, result, now) =>
    set((s) => ({
      results: { ...s.results, [pair]: result },
      computedAt: { ...s.computedAt, [pair]: now },
    })),

  setComputing: (v) => set({ computing: v }),

  reset: () => set({ results: {}, computedAt: {}, computing: false }),
}));

export const selectScoreResult =
  (pair: Pair) =>
  (s: ScoreStoreState): ScoreResult | undefined =>
    s.results[pair];
