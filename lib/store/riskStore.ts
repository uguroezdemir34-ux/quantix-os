/**
 * RISK STORE — Discipline log + BTC cooldown + lock state.
 *
 * Backend olan DisciplineLog class'ını Zustand store'a sarmalar.
 * BTC cooldown ve self-cooldown ayrı persisted state.
 *
 * Persist key'ler (panel ile birebir):
 *   - ug52_disc_log → DisciplineLog class kendi persist'i
 *   - ug52_btccd → btcCooldownUntil + reason + selfUntil
 *   - ug52_lock_released → lockReleasedAt
 */

import { create } from "zustand";
import { z } from "zod";
import { DisciplineLog, type DisciplineEntry, type DisciplineEventType } from "@/lib/risk/discipline-log";
import { loadFromStorage, saveToStorage } from "./persist";

const BTCCD_KEY = "btccd";
const LOCK_RELEASED_KEY = "lock_released";

const btcCooldownSchema = z.object({
  until: z.number().default(0),
  reason: z.string().default(""),
  selfUntil: z.number().default(0),
});

interface RiskStoreState {
  /** Snapshot — DisciplineLog'tan kopyalanır (Zustand reactivity için) */
  disciplineEntries: DisciplineEntry[];
  /** BTC cooldown — alt pair'leri engeller */
  btcCooldownUntil: number;
  btcCooldownReason: string;
  /** BTC self cooldown — BTC pair'ı kendi cooldown'u */
  btcSelfCooldownUntil: number;
  /** Lock release timestamp (ramp süresi için) */
  lockReleasedAt: number;
  /** Hydration done */
  _hydrated: boolean;

  // Actions
  logEvent: (
    type: DisciplineEventType,
    extra?: Record<string, unknown>,
  ) => void;
  setBtcCooldown: (until: number, reason: string) => void;
  setBtcSelfCooldown: (until: number) => void;
  clearBtcCooldown: () => void;
  setLockReleasedAt: (ts: number) => void;
  /** Discipline log'un tamamını silen kullanıcı aksiyonu */
  clearLog: () => void;
  rehydrate: () => void;
}

// Module-level singleton — Zustand store içinde tutmuyoruz çünkü class instance
// her render'da yeniden oluşturulmamalı.
let disciplineLogInstance: DisciplineLog | null = null;

function getOrCreateLog(): DisciplineLog {
  if (!disciplineLogInstance) {
    // Browser only: localStorage var
    const storage =
      typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : null;
    disciplineLogInstance = new DisciplineLog(storage);
  }
  return disciplineLogInstance;
}

/** Test helper — instance'ı sıfırla */
export function _resetDisciplineLogForTesting(): void {
  disciplineLogInstance = null;
}

export const useRiskStore = create<RiskStoreState>((set) => ({
  disciplineEntries: [],
  btcCooldownUntil: 0,
  btcCooldownReason: "",
  btcSelfCooldownUntil: 0,
  lockReleasedAt: 0,
  _hydrated: false,

  logEvent: (type, extra = {}) => {
    const log = getOrCreateLog();
    log.log(type, extra);
    // Snapshot al
    set({ disciplineEntries: [...log.getAll()] });
  },

  setBtcCooldown: (until, reason) => {
    set({ btcCooldownUntil: until, btcCooldownReason: reason });
    saveToStorage(BTCCD_KEY, {
      until,
      reason,
      selfUntil: useRiskStore.getState().btcSelfCooldownUntil,
    });
  },

  setBtcSelfCooldown: (until) => {
    set({ btcSelfCooldownUntil: until });
    const s = useRiskStore.getState();
    saveToStorage(BTCCD_KEY, {
      until: s.btcCooldownUntil,
      reason: s.btcCooldownReason,
      selfUntil: until,
    });
  },

  clearBtcCooldown: () => {
    set({
      btcCooldownUntil: 0,
      btcCooldownReason: "",
      btcSelfCooldownUntil: 0,
    });
    saveToStorage(BTCCD_KEY, { until: 0, reason: "", selfUntil: 0 });
  },

  setLockReleasedAt: (ts) => {
    set({ lockReleasedAt: ts });
    saveToStorage(LOCK_RELEASED_KEY, { ts });
  },

  clearLog: () => {
    const log = getOrCreateLog();
    log.clear();
    set({ disciplineEntries: [] });
  },

  rehydrate: () => {
    const log = getOrCreateLog();
    // Init zaten load() yapıyor — sadece snapshot al
    const btccd = loadFromStorage(
      BTCCD_KEY,
      { until: 0, reason: "", selfUntil: 0 },
      btcCooldownSchema,
    );
    const lockReleased = loadFromStorage(
      LOCK_RELEASED_KEY,
      { ts: 0 },
      z.object({ ts: z.number() }),
    );
    set({
      disciplineEntries: [...log.getAll()],
      btcCooldownUntil: btccd.until,
      btcCooldownReason: btccd.reason,
      btcSelfCooldownUntil: btccd.selfUntil,
      lockReleasedAt: lockReleased.ts,
      _hydrated: true,
    });
  },
}));

// ═══════════════ SELECTOR'LAR ═══════════════

/** Son N gün event'leri */
export const selectRecentEntries =
  (days: number, now: number = Date.now()) =>
  (s: RiskStoreState): DisciplineEntry[] => {
    const cutoff = now - days * 86400_000;
    return s.disciplineEntries.filter((e) => e.ts >= cutoff);
  };
