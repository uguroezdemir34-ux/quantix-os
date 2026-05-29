/**
 * ADHERENCE SCORE — Sistem uyumu skoru (0-100).
 *
 * Mantık:
 *   - 7 günlük pencerede tüm trade aksiyonlarını incele
 *   - "system_with" (sistem ile uyumlu trade) → pozitif
 *   - "system_against" (sistem aleyhine trade) → negatif
 *   - "rule_violation" (max trade/gün aşımı vs.) → ekstra negatif
 *
 * Skor: 100 (mükemmel) → 0 (felaket disiplin). 50 = nötr başlangıç.
 *
 * Kaynak: panel_v55_51.html satır 5779 (renderDisciplineScoreboard).
 *
 * Not: Bu modül saf fonksiyon. DisciplineLog class'ından `getAll()` ile
 * alınan entries dizisini input olarak alır.
 */

import type { DisciplineEntry } from "./discipline-log";

/** Config — ileride per-user ayarlanabilir */
export const ADHERENCE_CONFIG = {
  /** Lookback penceresi (gün) */
  WINDOW_DAYS: 7,
  /** Sistem ile uyumlu trade pozitif puan */
  WITH_SYSTEM_POINTS: 5,
  /** Sistem aleyhine trade negatif puan */
  AGAINST_SYSTEM_POINTS: -25,
  /** Rule violation negatif puan */
  RULE_VIOLATION_POINTS: -15,
  /** Başlangıç skoru (henüz aksiyon yok) */
  BASELINE: 50,
  /** Maks skor */
  MAX: 100,
  /** Min skor */
  MIN: 0,
} as const;

export interface AdherenceResult {
  /** 0-100 skor */
  score: number;
  /** Lookback penceresindeki sayımlar */
  withSystem: number;
  againstSystem: number;
  ruleViolation: number;
  totalTrades: number;
  /** Skor tier (UI rengi için) */
  tier: "excellent" | "good" | "fair" | "poor" | "critical";
}

/** Tier hesabı */
function tierFor(score: number): AdherenceResult["tier"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 30) return "poor";
  return "critical";
}

/**
 * Adherence score hesabı.
 *
 * @param entries Discipline log entry'leri (tümü, lookback içeride uygulanır)
 * @param now Şu an (epoch ms)
 */
export function computeAdherenceScore(
  entries: readonly DisciplineEntry[],
  now: number = Date.now(),
): AdherenceResult {
  const windowStart = now - ADHERENCE_CONFIG.WINDOW_DAYS * 86400_000;
  const recent = entries.filter((e) => e.ts >= windowStart);

  let withSystem = 0;
  let againstSystem = 0;
  let ruleViolation = 0;

  for (const e of recent) {
    if (e.type === "system_with") withSystem++;
    else if (e.type === "system_against") againstSystem++;
    else if (e.type === "rule_violation") ruleViolation++;
  }

  const totalTrades = withSystem + againstSystem;
  // Hiç aksiyon yoksa baseline döner (yeni kullanıcı)
  if (totalTrades === 0 && ruleViolation === 0) {
    return {
      score: ADHERENCE_CONFIG.BASELINE,
      withSystem,
      againstSystem,
      ruleViolation,
      totalTrades,
      tier: tierFor(ADHERENCE_CONFIG.BASELINE),
    };
  }

  const delta =
    withSystem * ADHERENCE_CONFIG.WITH_SYSTEM_POINTS +
    againstSystem * ADHERENCE_CONFIG.AGAINST_SYSTEM_POINTS +
    ruleViolation * ADHERENCE_CONFIG.RULE_VIOLATION_POINTS;

  const rawScore = ADHERENCE_CONFIG.BASELINE + delta;
  const score = Math.max(
    ADHERENCE_CONFIG.MIN,
    Math.min(ADHERENCE_CONFIG.MAX, Math.round(rawScore)),
  );

  return {
    score,
    withSystem,
    againstSystem,
    ruleViolation,
    totalTrades,
    tier: tierFor(score),
  };
}
