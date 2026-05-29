/**
 * SIGNAL RECONFIRMATION — İkinci execution gate.
 *
 * Preflight Layer 1'den geçen sinyal, emir gönderilmeden hemen önce bu
 * katmandan da geçer. Amaç: zaman gecikmesi + fiyat kayması nedeniyle
 * stale hale gelmiş sinyallerin execute edilmesini engellemek.
 *
 * 4 kontrol (sırayla, ilk fail → erken çıkış):
 *   1. Signal age        — sinyal N dakikadan eskiyse stale
 *   2. Price drift       — live fiyat referans fiyattan >X% sapmışsa drift
 *   3. Score margin      — score threshold'ın sadece M puan üzerindeyse marginal
 *   4. Direction still valid — EMA50_4h sinyalden bu yana aynı tarafta mı?
 *
 * Saf fonksiyonlar — I/O yok, test edilebilir.
 */

import type { ScoreResult } from "@/lib/score/orchestrator";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const RECONFIRM_DEFAULTS = {
  /** Sinyalin geçerlilik süresi (ms) — 5 dakika */
  MAX_SIGNAL_AGE_MS: 5 * 60 * 1000,
  /** Fiyat kayması eşiği (%) — referans fiyattan bu kadar sapma stale'e iter */
  MAX_PRICE_DRIFT_PCT: 0.5,
  /** Threshold üzerinde minimum puan marjı — bu altındaysa marginal */
  MIN_SCORE_MARGIN: 2,
} as const;

// ═══════════════════════════════════════════════════════════════════
// INPUT / OUTPUT
// ═══════════════════════════════════════════════════════════════════

export interface ReconfirmInput {
  /** Preflight'tan geçmiş ScoreResult */
  signal: ScoreResult;
  /** Sinyalin üretildiği zaman (ms) */
  signalTimestamp: number;
  /** Sinyalin üretildiği andaki referans fiyat */
  signalReferencePx: number;
  /** Şu anki canlı fiyat */
  livePrice: number;
  /** Şu anki 4H EMA50 (null → kontrol atlanır) */
  currentEma50_4h: number | null;
  /** Override: max sinyal yaşı (ms) — test + özel konfigürasyon */
  maxSignalAgeMs?: number;
  /** Override: max fiyat kayması (%) */
  maxPriceDriftPct?: number;
  /** Override: min skor marjı */
  minScoreMargin?: number;
  /** Şu an (test override) */
  now?: number;
}

export type ReconfirmFailReason =
  | "signal_stale"   // sinyal süresi dolmuş
  | "price_drift"    // fiyat çok kaymış
  | "score_marginal" // threshold'a çok yakın
  | "direction_flip"; // EMA yönü döndü

export interface ReconfirmResult {
  passed: boolean;
  failReason: ReconfirmFailReason | null;
  /** İnsanca açıklama (UI/log için) */
  reasonHuman: string;
  /** Diagnostics — her kontrol sonucu */
  checks: {
    ageMs: number;
    maxAgeMs: number;
    driftPct: number;
    maxDriftPct: number;
    scoreMargin: number;
    minMargin: number;
    directionFlipped: boolean | null; // null = EMA verisi yok, kontrol atlandı
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

/**
 * Sinyalin execute edilmeden önce hâlâ geçerli olup olmadığını doğrular.
 * Preflight'tan SONRA, exchange adapter'dan ÖNCE çağrılır.
 */
export function reconfirmSignal(input: ReconfirmInput): ReconfirmResult {
  const {
    signal,
    signalTimestamp,
    signalReferencePx,
    livePrice,
    currentEma50_4h,
    now = Date.now(),
  } = input;

  const maxAgeMs = input.maxSignalAgeMs ?? RECONFIRM_DEFAULTS.MAX_SIGNAL_AGE_MS;
  const maxDriftPct = input.maxPriceDriftPct ?? RECONFIRM_DEFAULTS.MAX_PRICE_DRIFT_PCT;
  const minMargin = input.minScoreMargin ?? RECONFIRM_DEFAULTS.MIN_SCORE_MARGIN;

  // 1. Sinyal yaşı
  const ageMs = now - signalTimestamp;
  if (ageMs > maxAgeMs) {
    return fail("signal_stale", {
      ageMs,
      maxAgeMs,
      driftPct: 0,
      maxDriftPct,
      scoreMargin: 0,
      minMargin,
      directionFlipped: null,
    }, `Signal stale: ${Math.round(ageMs / 1000)}s old (max ${Math.round(maxAgeMs / 1000)}s)`);
  }

  // 2. Fiyat kayması
  const driftPct =
    signalReferencePx > 0
      ? (Math.abs(livePrice - signalReferencePx) / signalReferencePx) * 100
      : 0;
  if (driftPct > maxDriftPct) {
    return fail("price_drift", {
      ageMs,
      maxAgeMs,
      driftPct,
      maxDriftPct,
      scoreMargin: 0,
      minMargin,
      directionFlipped: null,
    }, `Price drifted ${driftPct.toFixed(2)}% from reference (max ${maxDriftPct}%)`);
  }

  // 3. Skor marjı — total score vs effectiveThreshold
  const scoreMargin = signal.total - signal.effectiveThreshold;
  if (scoreMargin < minMargin) {
    return fail("score_marginal", {
      ageMs,
      maxAgeMs,
      driftPct,
      maxDriftPct,
      scoreMargin,
      minMargin,
      directionFlipped: null,
    }, `Score margin too thin: ${signal.total} vs threshold ${signal.effectiveThreshold} (margin=${scoreMargin.toFixed(1)}, min=${minMargin})`);
  }

  // 4. EMA yönü kontrolü (opsiyonel — veri yoksa atla)
  let directionFlipped: boolean | null = null;
  if (currentEma50_4h !== null && livePrice > 0) {
    const wasLong = signal.direction === "LONG";
    const wasShort = signal.direction === "SHORT";
    const isNowAbove = livePrice > currentEma50_4h;
    const isNowBelow = livePrice < currentEma50_4h;

    if ((wasLong && isNowBelow) || (wasShort && isNowAbove)) {
      directionFlipped = true;
      return fail("direction_flip", {
        ageMs,
        maxAgeMs,
        driftPct,
        maxDriftPct,
        scoreMargin,
        minMargin,
        directionFlipped,
      }, `Direction flipped: signal was ${signal.direction}, price now ${isNowAbove ? "above" : "below"} EMA50_4h`);
    }
    directionFlipped = false;
  }

  return {
    passed: true,
    failReason: null,
    reasonHuman: "Signal reconfirmed — all checks passed",
    checks: { ageMs, maxAgeMs, driftPct, maxDriftPct, scoreMargin, minMargin, directionFlipped },
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function fail(
  reason: ReconfirmFailReason,
  checks: ReconfirmResult["checks"],
  reasonHuman: string,
): ReconfirmResult {
  return { passed: false, failReason: reason, reasonHuman, checks };
}
