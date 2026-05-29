/**
 * EQUITY CURVE CIRCUIT BREAKER — Haftalık / Aylık drawdown koruma katmanı.
 *
 * Günlük drawdown-protocol.ts zaten -1.5% / -2.5% / -3% eşiklerini işler.
 * Bu modül üstüne haftalık ve aylık kümülatif eşikler ekler:
 *
 *   Haftalık  -5.0% → Restricted (¼ risk) — haftanın geri kalanı
 *   Haftalık  -7.5% → Locked (Full Halt) — haftanın geri kalanı
 *   Aylık    -12.0% → Monthly Locked — ayın geri kalanı (Siber Kilit)
 *
 * Öncelik: aylık > haftalık > günlük (en kısıtlayıcı tier kazanır).
 *
 * Saf fonksiyonlar — I/O yok.
 */

export interface EquityCurveInput {
  /** Günlük P&L yüzdesi (genellikle accountStore.dailyPnlPct) */
  dailyPnlPct: number;
  /** Haftalık kümülatif P&L yüzdesi (0 = bu hafta giriş yok) */
  weeklyPnlPct: number;
  /** Aylık kümülatif P&L yüzdesi */
  monthlyPnlPct: number;
}

export type EquityTier = "normal" | "caution" | "restricted" | "locked";

export interface EquityCurveDecision {
  tier: EquityTier;
  multiplier: number;
  minScore: number;
  label: string;
  reason: string;
  /** Hangi zaman diliminin eşiği tetikledi */
  triggeredBy: "daily" | "weekly" | "monthly" | null;
}

// ─── Eşikler ─────────────────────────────────────────────────

export const EQUITY_THRESHOLDS = {
  // Haftalık
  WEEKLY_RESTRICTED: -5.0,
  WEEKLY_LOCKED: -7.5,
  // Aylık Siber Kilit
  MONTHLY_LOCKED: -12.0,
} as const;

// ─── Saf Fonksiyonlar ────────────────────────────────────────

/**
 * Haftalık P&L → karar.
 */
export function weeklyEquityTier(
  weeklyPnlPct: number,
): Pick<EquityCurveDecision, "tier" | "multiplier" | "minScore" | "label" | "reason"> | null {
  if (!Number.isFinite(weeklyPnlPct) || weeklyPnlPct >= EQUITY_THRESHOLDS.WEEKLY_RESTRICTED) {
    return null; // eşik aşılmadı
  }

  if (weeklyPnlPct <= EQUITY_THRESHOLDS.WEEKLY_LOCKED) {
    return {
      tier: "locked",
      multiplier: 0,
      minScore: 100,
      label: "🔒 Haftalık Full Halt",
      reason: `Haftalık kayıp %${weeklyPnlPct.toFixed(2)} — haftalık tam kilit (≤-7.5%)`,
    };
  }

  return {
    tier: "restricted",
    multiplier: 0.25,
    minScore: 85,
    label: "🟠 Haftalık Kısıtlı",
    reason: `Haftalık kayıp %${weeklyPnlPct.toFixed(2)} — risk ¼ (≤-5%)`,
  };
}

/**
 * Aylık P&L → karar.
 */
export function monthlyEquityTier(
  monthlyPnlPct: number,
): Pick<EquityCurveDecision, "tier" | "multiplier" | "minScore" | "label" | "reason"> | null {
  if (!Number.isFinite(monthlyPnlPct) || monthlyPnlPct >= EQUITY_THRESHOLDS.MONTHLY_LOCKED) {
    return null;
  }

  return {
    tier: "locked",
    multiplier: 0,
    minScore: 100,
    label: "🔒 Aylık Siber Kilit",
    reason: `Aylık kayıp %${monthlyPnlPct.toFixed(2)} — aylık siber kilit (≤-12%)`,
  };
}

/**
 * Tüm zaman dilimlerini birleştir — en kısıtlayıcı tier kazanır.
 *
 * Öncelik sırası: aylık > haftalık > günlük.
 * Günlük tier dışarıdan (drawdown-protocol) gelir; burada sadece weekly/monthly
 * katmanları hesaplanır ve sonuç günlük ile karşılaştırılır.
 */
export function computeEquityCurveDecision(
  input: EquityCurveInput,
): EquityCurveDecision {
  // Aylık — en yüksek öncelik
  const monthly = monthlyEquityTier(input.monthlyPnlPct);
  if (monthly) {
    return { ...monthly, triggeredBy: "monthly" };
  }

  // Haftalık
  const weekly = weeklyEquityTier(input.weeklyPnlPct);
  if (weekly) {
    return { ...weekly, triggeredBy: "weekly" };
  }

  // Günlük (sadece locked / restricted tier'ları burada da yakala)
  const dp = input.dailyPnlPct;
  if (Number.isFinite(dp)) {
    if (dp <= -3.0) {
      return {
        tier: "locked",
        multiplier: 0,
        minScore: 100,
        label: "🔒 Günlük Kilit",
        reason: `Günlük kayıp %${dp.toFixed(2)}`,
        triggeredBy: "daily",
      };
    }
    if (dp <= -2.5) {
      return {
        tier: "restricted",
        multiplier: 0.25,
        minScore: 85,
        label: "🟠 Kısıtlı",
        reason: `Günlük kayıp %${dp.toFixed(2)} — risk ¼`,
        triggeredBy: "daily",
      };
    }
    if (dp <= -1.5) {
      return {
        tier: "caution",
        multiplier: 0.5,
        minScore: 80,
        label: "🟡 Dikkat",
        reason: `Günlük kayıp %${dp.toFixed(2)} — risk ½`,
        triggeredBy: "daily",
      };
    }
  }

  return {
    tier: "normal",
    multiplier: 1.0,
    minScore: 80,
    label: "🟢 Normal",
    reason: "Drawdown sınırları içinde",
    triggeredBy: null,
  };
}

/**
 * Belirli bir zaman dilimine ait P&L sıfırlanmalı mı?
 * EOD (gün sonu) reset kontrolü — `lastResetAt` o günün başından büyükse sıfırlama gerekmiyor.
 */
export function needsDailyReset(lastResetAt: number, now: number): boolean {
  const todayStart = getDayStart(now);
  return lastResetAt < todayStart;
}

export function needsWeeklyReset(lastResetAt: number, now: number): boolean {
  const weekStart = getWeekStart(now);
  return lastResetAt < weekStart;
}

export function needsMonthlyReset(lastResetAt: number, now: number): boolean {
  const monthStart = getMonthStart(now);
  return lastResetAt < monthStart;
}

// ─── Zaman yardımcıları ──────────────────────────────────────

export function getDayStart(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function getWeekStart(now: number): number {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // ISO: Mon=0
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function getMonthStart(now: number): number {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
