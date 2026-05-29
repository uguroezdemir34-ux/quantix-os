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
import {
  needsDailyReset,
  needsWeeklyReset,
  needsMonthlyReset,
} from "@/lib/risk/equity-curve";

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
  /** Haftalık kümülatif P&L yüzdesi */
  weeklyPnlPct: number;
  /** Aylık kümülatif P&L yüzdesi */
  monthlyPnlPct: number;
  /** Son günlük reset zamanı (epoch ms) */
  lastDailyResetAt: number;
  /** Son haftalık reset zamanı (epoch ms) */
  lastWeeklyResetAt: number;
  /** Son aylık reset zamanı (epoch ms) */
  lastMonthlyResetAt: number;
  /** Drawdown protocol (dailyPnlPct'den hesaplanır) */
  drawdownProtocol: DrawdownProtocol;
  /** Hidrate edildi mi (SSR guard) */
  _hydrated: boolean;

  // Actions
  setBalance: (total: number, free: number) => void;
  setDailyPnlPct: (pct: number) => void;
  setWeeklyPnlPct: (pct: number) => void;
  setMonthlyPnlPct: (pct: number) => void;
  /**
   * Periyodik reset kontrolü — her tick veya strateji döngüsünde çağrılabilir.
   * Gerekli periyotları sıfırlar (gün/hafta/ay geçmişse).
   */
  checkAndResetPeriods: (now?: number) => void;
  rehydrate: () => void;
}

// Persist key — STORAGE_PREFIX otomatik eklenir (persist.ts)
const STORAGE_KEY = "account_state";

const accountSchema = z.object({
  balanceTotal: z.number(),
  balanceFree: z.number(),
  dailyPnlPct: z.number(),
  weeklyPnlPct: z.number().optional(),
  monthlyPnlPct: z.number().optional(),
  lastDailyResetAt: z.number().optional(),
  lastWeeklyResetAt: z.number().optional(),
  lastMonthlyResetAt: z.number().optional(),
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

export const useAccountStore = create<AccountStoreState>((set, get) => ({
  balanceTotal: DEFAULT_BALANCE_TOTAL,
  balanceFree: DEFAULT_BALANCE_FREE,
  dailyPnlPct: 0,
  weeklyPnlPct: 0,
  monthlyPnlPct: 0,
  lastDailyResetAt: 0,
  lastWeeklyResetAt: 0,
  lastMonthlyResetAt: 0,
  drawdownProtocol: computeDrawdownProtocol(0),
  _hydrated: false,

  setBalance: (total, free) => {
    set({ balanceTotal: total, balanceFree: free });
    const state = get();
    saveToStorage<PersistedAccount>(STORAGE_KEY, buildPersisted(state, { balanceTotal: total, balanceFree: free }));
  },

  setDailyPnlPct: (pct) => {
    const protocol = computeDrawdownProtocol(pct);
    set({ dailyPnlPct: pct, drawdownProtocol: protocol });
    const state = get();
    saveToStorage<PersistedAccount>(STORAGE_KEY, buildPersisted(state, { dailyPnlPct: pct }));
  },

  setWeeklyPnlPct: (pct) => {
    set({ weeklyPnlPct: pct });
    const state = get();
    saveToStorage<PersistedAccount>(STORAGE_KEY, buildPersisted(state, { weeklyPnlPct: pct }));
  },

  setMonthlyPnlPct: (pct) => {
    set({ monthlyPnlPct: pct });
    const state = get();
    saveToStorage<PersistedAccount>(STORAGE_KEY, buildPersisted(state, { monthlyPnlPct: pct }));
  },

  checkAndResetPeriods: (now = Date.now()) => {
    const state = get();
    const updates: Partial<AccountStoreState> = {};

    if (needsDailyReset(state.lastDailyResetAt, now)) {
      updates.dailyPnlPct = 0;
      updates.drawdownProtocol = computeDrawdownProtocol(0);
      updates.lastDailyResetAt = now;
    }
    if (needsWeeklyReset(state.lastWeeklyResetAt, now)) {
      updates.weeklyPnlPct = 0;
      updates.lastWeeklyResetAt = now;
    }
    if (needsMonthlyReset(state.lastMonthlyResetAt, now)) {
      updates.monthlyPnlPct = 0;
      updates.lastMonthlyResetAt = now;
    }

    if (Object.keys(updates).length > 0) {
      set(updates);
      const newState = { ...state, ...updates };
      saveToStorage<PersistedAccount>(STORAGE_KEY, buildPersisted(newState, {}));
    }
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
      weeklyPnlPct: persisted.weeklyPnlPct ?? 0,
      monthlyPnlPct: persisted.monthlyPnlPct ?? 0,
      lastDailyResetAt: persisted.lastDailyResetAt ?? 0,
      lastWeeklyResetAt: persisted.lastWeeklyResetAt ?? 0,
      lastMonthlyResetAt: persisted.lastMonthlyResetAt ?? 0,
      drawdownProtocol: computeDrawdownProtocol(persisted.dailyPnlPct),
      _hydrated: true,
    });
  },
}));

function buildPersisted(
  state: AccountStoreState,
  overrides: Partial<PersistedAccount>,
): PersistedAccount {
  return {
    balanceTotal: state.balanceTotal,
    balanceFree: state.balanceFree,
    dailyPnlPct: state.dailyPnlPct,
    weeklyPnlPct: state.weeklyPnlPct,
    monthlyPnlPct: state.monthlyPnlPct,
    lastDailyResetAt: state.lastDailyResetAt,
    lastWeeklyResetAt: state.lastWeeklyResetAt,
    lastMonthlyResetAt: state.lastMonthlyResetAt,
    ...overrides,
  };
}
