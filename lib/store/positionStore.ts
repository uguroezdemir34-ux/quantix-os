/**
 * POSITION STORE — Açık pozisyon listesi state.
 *
 * Persist edilmez (OKX'ten her seferinde fetch edilir).
 */

import { create } from "zustand";
import type { Position } from "@/lib/okx/positions";

interface PositionStoreState {
  positions: Position[];
  lastFetchedAt: number;
  lastError: string;
  /** Şu an kapatılma sürecinde olan position instId (UI loading state için) */
  closingInstId: string | null;

  // Actions
  setPositions: (positions: Position[]) => void;
  setError: (err: string) => void;
  removePosition: (instId: string) => void;
  setClosingInstId: (instId: string | null) => void;
  reset: () => void;
}

export const usePositionStore = create<PositionStoreState>((set) => ({
  positions: [],
  lastFetchedAt: 0,
  lastError: "",
  closingInstId: null,

  setPositions: (positions) =>
    set({
      positions,
      lastFetchedAt: Date.now(),
      lastError: "",
    }),

  setError: (err) => set({ lastError: err }),

  removePosition: (instId) =>
    set((s) => ({ positions: s.positions.filter((p) => p.instId !== instId) })),

  setClosingInstId: (instId) => set({ closingInstId: instId }),

  reset: () =>
    set({
      positions: [],
      lastFetchedAt: 0,
      lastError: "",
      closingInstId: null,
    }),
}));

// ═══════════════ SELECTOR'LAR ═══════════════

export const selectPositionByInstId =
  (instId: string) =>
  (s: PositionStoreState): Position | undefined =>
    s.positions.find((p) => p.instId === instId);

export const selectPositionsByPair =
  (pair: string) =>
  (s: PositionStoreState): Position[] =>
    s.positions.filter((p) => p.pair === pair);

export const selectHasOpenPositions = (s: PositionStoreState): boolean =>
  s.positions.length > 0;
