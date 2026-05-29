/**
 * MACRO STORE — Piyasa sekmesi için snapshot (F&G, dominance, funding).
 *
 * Refresh stratejisi:
 *   - F&G: macro/cache layer (30dk TTL)
 *   - Dominance: macro/cache layer (30dk TTL)
 *   - Funding: 5dk TTL — store level
 *
 * Store sadece state tutar — fetch'leri kendi tetiklemiyor.
 * UI veya hook tetikler (refreshAll()).
 *
 * NOT: WS price tick'leri için ayrı store var (`marketStore.ts`).
 */

import { create } from "zustand";
import { fetchFearGreed, fetchBtcDominance } from "@/lib/macro/fetch";
import {
  getFgInfo,
  getDominancePhase,
  getMarketSummary,
} from "@/lib/macro/regime";
import {
  fetchFundingRate,
  type FundingRateResult,
} from "@/lib/market/fundingRate";
import {
  fetchOpenInterest,
  type OpenInterestResult,
} from "@/lib/market/openInterest";
import type {
  FgInfo,
  DominanceInfo,
  MarketSummary,
} from "@/lib/macro/types";

const FUNDING_TTL_MS = 5 * 60_000;
const OI_TTL_MS = 5 * 60_000;

interface MacroStoreState {
  // F&G (raw value + computed info)
  fgValue: number | null;
  fgInfo: FgInfo | null;
  fgFetchedAt: number;
  fgLoading: boolean;

  // Dominance (raw values + computed phase)
  btcD: number | null;
  usdtD: number | null;
  dominance: DominanceInfo | null;
  domFetchedAt: number;
  domLoading: boolean;

  // Funding (BTC + ETH)
  fundingBtc: FundingRateResult | null;
  fundingEth: FundingRateResult | null;
  fundingFetchedAt: number;
  fundingLoading: boolean;

  // Open Interest (BTC + ETH)
  oiBtc: OpenInterestResult | null;
  oiEth: OpenInterestResult | null;
  oiFetchedAt: number;
  oiLoading: boolean;

  // Computed: market summary
  marketSummary: MarketSummary | null;

  // Actions
  refreshFg: (fetchFn?: typeof fetch) => Promise<void>;
  refreshDominance: (fetchFn?: typeof fetch) => Promise<void>;
  refreshFunding: (fetchFn?: typeof fetch) => Promise<void>;
  refreshOpenInterest: (fetchFn?: typeof fetch) => Promise<void>;
  refreshAll: (fetchFn?: typeof fetch) => Promise<void>;

  // Test helper
  _reset: () => void;
}

/** F&G + USDT-D varsa market summary hesapla */
function recomputeSummary(
  fg: number | null,
  usdtD: number | null,
): MarketSummary | null {
  if (fg === null || usdtD === null) return null;
  return getMarketSummary(fg, usdtD);
}

const initialState = {
  fgValue: null,
  fgInfo: null,
  fgFetchedAt: 0,
  fgLoading: false,
  btcD: null,
  usdtD: null,
  dominance: null,
  domFetchedAt: 0,
  domLoading: false,
  fundingBtc: null,
  fundingEth: null,
  fundingFetchedAt: 0,
  fundingLoading: false,
  oiBtc: null,
  oiEth: null,
  oiFetchedAt: 0,
  oiLoading: false,
  marketSummary: null,
};

export const useMacroStore = create<MacroStoreState>((set, get) => ({
  ...initialState,

  refreshFg: async (fetchFn) => {
    if (get().fgLoading) return;
    set({ fgLoading: true });
    try {
      const now = Date.now();
      const r = await fetchFearGreed(now, fetchFn);
      const info = getFgInfo(r.value);
      const usdtD = get().usdtD;
      set({
        fgValue: r.value,
        fgInfo: info,
        fgFetchedAt: now,
        fgLoading: false,
        marketSummary: recomputeSummary(r.value, usdtD),
      });
    } catch {
      set({ fgLoading: false });
    }
  },

  refreshDominance: async (fetchFn) => {
    if (get().domLoading) return;
    set({ domLoading: true });
    try {
      const now = Date.now();
      const r = await fetchBtcDominance(now, fetchFn);
      const info = getDominancePhase(r.btcD, r.usdtD);
      const fgValue = get().fgValue;
      set({
        btcD: r.btcD,
        usdtD: r.usdtD,
        dominance: info,
        domFetchedAt: now,
        domLoading: false,
        marketSummary: recomputeSummary(fgValue, r.usdtD),
      });
    } catch {
      set({ domLoading: false });
    }
  },

  refreshFunding: async (fetchFn) => {
    if (get().fundingLoading) return;
    const now = Date.now();
    if (now - get().fundingFetchedAt < FUNDING_TTL_MS) return;

    set({ fundingLoading: true });
    try {
      const [btc, eth] = await Promise.all([
        fetchFundingRate("BTC", fetchFn),
        fetchFundingRate("ETH", fetchFn),
      ]);
      set({
        fundingBtc: btc,
        fundingEth: eth,
        fundingFetchedAt: now,
        fundingLoading: false,
      });
    } catch {
      set({ fundingLoading: false });
    }
  },

  refreshOpenInterest: async (fetchFn) => {
    if (get().oiLoading) return;
    const now = Date.now();
    if (now - get().oiFetchedAt < OI_TTL_MS) return;

    set({ oiLoading: true });
    try {
      const [btc, eth] = await Promise.all([
        fetchOpenInterest("BTC", fetchFn),
        fetchOpenInterest("ETH", fetchFn),
      ]);
      set({
        oiBtc: btc,
        oiEth: eth,
        oiFetchedAt: now,
        oiLoading: false,
      });
    } catch {
      set({ oiLoading: false });
    }
  },

  refreshAll: async (fetchFn) => {
    await Promise.all([
      get().refreshFg(fetchFn),
      get().refreshDominance(fetchFn),
      get().refreshFunding(fetchFn),
      get().refreshOpenInterest(fetchFn),
    ]);
  },

  _reset: () => set(initialState),
}));
