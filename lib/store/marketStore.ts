/**
 * MARKET STORE — Real-time market state.
 *
 * WS client'tan gelen tick'leri tutan, UI'ın subscribe ettiği Zustand store.
 *
 * Panel'in ST.px objesinin v2 karşılığı, ama:
 *   - Tipli (Pair'lere göre kayıt)
 *   - Persistence YOK (real-time veri, sayfa yenilenince yenisi gelir)
 *   - Connection status + last tick zamanı + tick sayacı (debug için)
 *
 * Bu store WS client'a doğrudan bağlı DEĞİL — `useMarketStream` hook'u
 * client'ı oluşturur ve tick'leri buraya iter. Bu sayede:
 *   - Test'te store'a manuel tick push edilebilir
 *   - Server-side render'da store boş kalır (WS client browser-only)
 */

import { create } from "zustand";
import type { Pair } from "@/lib/constants/pairs";
import type { Tick, ConnectionState } from "@/lib/ws/types";

interface MarketStoreState {
  /** Pair → en son tick (snapshot) */
  prices: Partial<Record<Pair, Tick>>;
  /** WS bağlantı durumu */
  connection: ConnectionState;
  /** Pair bazlı tick sayacı (debug/health monitor için) */
  tickCount: Partial<Record<Pair, number>>;

  // Actions
  /** Yeni tick geldi — store'u güncelle */
  pushTick: (tick: Tick) => void;
  /** Bağlantı durumu güncellendi */
  setConnection: (state: ConnectionState) => void;
  /** Store'u sıfırla (sayfa unload veya manuel disconnect) */
  reset: () => void;
}

const initialConnection: ConnectionState = {
  status: "idle",
  currentUrl: null,
  currentType: null,
  retries: 0,
  lastTickAt: 0,
  connectedAt: null,
};

export const useMarketStore = create<MarketStoreState>((set) => ({
  prices: {},
  connection: initialConnection,
  tickCount: {},

  pushTick: (tick) =>
    set((s) => ({
      prices: { ...s.prices, [tick.pair]: tick },
      tickCount: {
        ...s.tickCount,
        [tick.pair]: (s.tickCount[tick.pair] ?? 0) + 1,
      },
    })),

  setConnection: (connection) => set({ connection }),

  reset: () =>
    set({
      prices: {},
      connection: initialConnection,
      tickCount: {},
    }),
}));

// ═══════════════ SELECTOR'LAR ═══════════════

/** Belirli bir pair'in son fiyatını seç */
export const selectPrice =
  (pair: Pair) =>
  (s: MarketStoreState): Tick | undefined =>
    s.prices[pair];

/** Bağlantı durum metni (UI rozeti için) */
export const selectConnectionStatus = (s: MarketStoreState) =>
  s.connection.status;

/** Pair sayısı tick almış olan */
export const selectActivePairCount = (s: MarketStoreState): number =>
  Object.values(s.tickCount).filter((c) => (c ?? 0) > 0).length;
