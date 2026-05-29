/**
 * STRUCTURAL STOP — Yapısal swing low/high + ATR hibrit stop hesabı.
 *
 * Kaynak: panel_v55_51.html satır 4602-4668 (computeStructuralStop).
 *
 * Mantık:
 *   1. Swing seviyesi yok → 1.5× ATR fallback
 *   2. Swing yanlış tarafta → 1.5× ATR fallback
 *   3. Swing < 0.8× ATR yakın → 1.0× ATR genişletildi
 *   4. Swing > 2.5× ATR uzak → 1.5× ATR fallback
 *   5. İdeal aralık → yapısal stop (swing - 0.3× ATR buffer)
 */

import type { Direction } from "@/lib/score/orchestrator";
import type { StopResult } from "./types";
import { SIZER_CONFIG } from "./types";

/**
 * Yapısal stop hesabı.
 *
 * @param direction LONG veya SHORT
 * @param px Anlık fiyat
 * @param atr ATR değeri
 * @param swingLow LONG için yapısal alt seviye
 * @param swingHigh SHORT için yapısal üst seviye
 */
export function computeStructuralStop(
  direction: Direction,
  px: number,
  atr: number,
  swingLow: number | null,
  swingHigh: number | null,
): StopResult {
  if (direction === "NEUTRAL") {
    // NEUTRAL'da stop hesabı yok, ama defansif: ATR fallback
    return {
      stopPrice: px,
      stopDistance: 0,
      kind: "atr_no_pivot",
      label: "NEUTRAL — stop yok",
      swingLevel: null,
    };
  }

  const isLong = direction === "LONG";
  const buffer = SIZER_CONFIG.STOP_BUFFER_ATR * atr;
  const swingLevel = isLong ? swingLow : swingHigh;

  // 1. Swing yok → ATR fallback
  if (swingLevel === null || swingLevel === undefined) {
    const dist = SIZER_CONFIG.ATR_FALLBACK_MULT * atr;
    return {
      stopPrice: isLong ? px - dist : px + dist,
      stopDistance: dist,
      kind: "atr_no_pivot",
      label: "ATR fallback (yapı yok)",
      swingLevel: null,
    };
  }

  // Yapısal stop adayı
  const candidatePrice = isLong ? swingLevel - buffer : swingLevel + buffer;
  const candidateDist = Math.abs(px - candidatePrice);

  // 2. Yapısal seviye yanlış tarafta → ATR fallback
  if ((isLong && candidatePrice >= px) || (!isLong && candidatePrice <= px)) {
    const dist = SIZER_CONFIG.ATR_FALLBACK_MULT * atr;
    return {
      stopPrice: isLong ? px - dist : px + dist,
      stopDistance: dist,
      kind: "atr_invalid_pivot",
      label: "ATR fallback (yapı geçersiz)",
      swingLevel,
    };
  }

  // 3. Çok yakın → gürültü bölgesi, 1.0× ATR'ye genişlet
  if (candidateDist < SIZER_CONFIG.STOP_TOO_CLOSE_ATR * atr) {
    const dist = SIZER_CONFIG.WIDENED_STOP_MULT * atr;
    return {
      stopPrice: isLong ? px - dist : px + dist,
      stopDistance: dist,
      kind: "widened",
      label: `Yapı genişletildi (${(candidateDist / atr).toFixed(1)}× ATR çok yakın)`,
      swingLevel,
    };
  }

  // 4. Çok uzak → R:R bozulur, ATR fallback
  if (candidateDist > SIZER_CONFIG.STOP_TOO_FAR_ATR * atr) {
    const dist = SIZER_CONFIG.ATR_FALLBACK_MULT * atr;
    return {
      stopPrice: isLong ? px - dist : px + dist,
      stopDistance: dist,
      kind: "atr_too_far",
      label: `ATR fallback (yapı ${(candidateDist / atr).toFixed(1)}× ATR uzak)`,
      swingLevel,
    };
  }

  // 5. İdeal aralık → yapısal stop
  return {
    stopPrice: candidatePrice,
    stopDistance: candidateDist,
    kind: "structural",
    label: `Yapısal swing (${(candidateDist / atr).toFixed(1)}× ATR)`,
    swingLevel,
  };
}
