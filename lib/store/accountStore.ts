/**
 * ACCOUNT STORE — Hesap bakiyesi + drawdown protokol state'i.
 *
 * Bu store gerçek OKX bakiye fetch'i Faz 2 #7'de eklenecek. Şu an
 * kullanıcı manuel olarak ayar girer (test için varsayılan değerler).
 *
 * Persistence: ug52_account_ prefix'i.
 */

import { create } from "zustand";
import { loadFromStorage, saveToStorage } from "./persist";
import { z } from "zod";

export type DrawdownTier = "normal" | "caution" | "restricted" | "locked";

export interface DrawdownProtocol {
  tier: DrawdownTier;
  multiplier: number;
  label: string;
}

interface AccountStoreState {
  /** Toplam bakiye (USDT) */
  balanceTotal: number;
  /** Serbest margin (USDT) */
  balanceFree: number;
  /** Günlük P&L yüzdesi */
  dailyPnlPct: number;
  /** Drawdown protocol (dailyPnlPct'den hesaplanır) */
  drawdownProtocol: DrawdownProtocol;
  /** Hidrate edildi mi (SSR guard) */
  _hydrated: boolean;

  // Actions
  setBalance: (total: number, free: number) => void;
  setDailyPnlPct: (pct: number) => void;
  rehydrate: () => void;
}

// Persist key — STORAGE_PREFIX otomatik eklenir (persist.ts)
const STORAGE_KEY = "account_state";

const accountSchema = z.object({
  balanceTotal: z.number(),
  balanceFree: z.number(),
  dailyPnlPct: z.number(),
});

type PersistedAccount = z.infer<typeof accountSchema>;

/** Drawdown protocol — günlük P&L yüzdesinden tier hesabı */
export function computeDrawdownProtocol(dailyPnlPct: number): DrawdownProtocol {
  if (!Number.isFinite(dailyPnlPct)) {
    return { tier: "normal", multiplier: 1.0, label: "🟢 Normal" };
  }
  if (dailyPnlPct <= -3.0) {
    return { tier: "locked", multiplier: 0, label: "🔒 Locked" };
  }
  if (dailyPnlPct <= -2.5) {
    return {
      tier: "restricted",
      multiplier: 0.25,
      label: "🟠 Restricted (¼×)",
    };
  }
  if (dailyPnlPct <= -1.5) {
    return { tier: "caution", multiplier: 0.5, label: "🟡 Caution (½×)" };
  }
  return { tier: "normal", multiplier: 1.0, label: "🟢 Normal" };
}

const DEFAULT_BALANCE_TOTAL = 80; // Uğur'un başlangıç sermayesi
const DEFAULT_BALANCE_FREE = 80;

export const useAccountStore = create<AccountStoreState>((set) => ({
  balanceTotal: DEFAULT_BALANCE_TOTAL,
  balanceFree: DEFAULT_BALANCE_FREE,
  dailyPnlPct: 0,
  drawdownProtocol: computeDrawdownProtocol(0),
  _hydrated: false,

  setBalance: (total, free) => {
    set({ balanceTotal: total, balanceFree: free });
    const state = useAccountStore.getState();
    saveToStorage<PersistedAccount>(STORAGE_KEY, {
      balanceTotal: total,
      balanceFree: free,
      dailyPnlPct: state.dailyPnlPct,
    });
  },

  setDailyPnlPct: (pct) => {
    const protocol = computeDrawdownProtocol(pct);
    set({ dailyPnlPct: pct, drawdownProtocol: protocol });
    const state = useAccountStore.getState();
    saveToStorage<PersistedAccount>(STORAGE_KEY, {
      balanceTotal: state.balanceTotal,
      balanceFree: state.balanceFree,
      dailyPnlPct: pct,
    });
  },

  rehydrate: () => {
    const defaultPersisted: PersistedAccount = {
      balanceTotal: DEFAULT_BALANCE_TOTAL,
      balanceFree: DEFAULT_BALANCE_FREE,
      dailyPnlPct: 0,
    };
    const persisted = loadFromStorage<PersistedAccount>(
      STORAGE_KEY,
      defaultPersisted,
      accountSchema,
    );
    set({
      balanceTotal: persisted.balanceTotal,
      balanceFree: persisted.balanceFree,
      dailyPnlPct: persisted.dailyPnlPct,
      drawdownProtocol: computeDrawdownProtocol(persisted.dailyPnlPct),
      _hydrated: true,
    });
  },
}));
