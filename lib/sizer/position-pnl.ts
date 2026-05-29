/**
 * POSITION P&L — Saf hesap fonksiyonları.
 *
 * Hiçbir state'e bağlı değil, pure functions. Test edilebilir.
 */

import type { Position } from "@/lib/okx/positions";

/**
 * UPL'yi yeniden hesapla (OKX'in baseline upl + güncel markPx farkı).
 *
 * Panel v55.51 (satır 592-593) approach: OKX upl baseline al, sadece
 * markPx → currentPrice farkını ekle. Bu drift'i önler.
 *
 * @param pos OKX pozisyon
 * @param currentPx WS'den gelen anlık fiyat
 */
export function computeLiveUpl(pos: Position, currentPx: number): number {
  if (currentPx <= 0 || pos.markPx <= 0) return pos.upl;
  // size sign-aware: LONG positive, SHORT negative
  const sign = pos.direction === "SHORT" ? -1 : 1;
  const delta = sign * (currentPx - pos.markPx) * pos.size;
  return pos.upl + delta;
}

/**
 * ROE % (Return on Equity).
 *
 * ROE = UPL / margin × 100
 * margin = notional / leverage
 */
export function computeRoe(pos: Position, livePx?: number): number {
  if (pos.leverage <= 0) return 0;
  const margin = pos.notional / pos.leverage;
  if (margin <= 0) return 0;
  const upl = livePx !== undefined ? computeLiveUpl(pos, livePx) : pos.upl;
  return (upl / margin) * 100;
}

/**
 * TP1 progress yüzdesi (0-100).
 * Entry → TP1 mesafesinin ne kadarı katedilmiş?
 *
 * LONG: progress = (current - entry) / (tp1 - entry) × 100
 * SHORT: progress = (entry - current) / (entry - tp1) × 100
 *
 * Negatif değerler 0'a, 100'ün üstü 100'e clamp.
 * TP1 yoksa null.
 */
export function computeTpProgress(
  pos: Position,
  currentPx: number,
): number | null {
  if (!pos.tpTriggerPx || pos.tpTriggerPx <= 0) return null;
  if (currentPx <= 0) return null;

  const isLong = pos.direction === "LONG";
  const numerator = isLong ? currentPx - pos.entryPx : pos.entryPx - currentPx;
  const denominator = isLong
    ? pos.tpTriggerPx - pos.entryPx
    : pos.entryPx - pos.tpTriggerPx;

  if (denominator <= 0) return null;
  const pct = (numerator / denominator) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Stop'a kalan mesafe (yüzde olarak — % entry'den).
 * Negatif = stop already crossed.
 */
export function computeStopDistance(pos: Position, currentPx: number): number | null {
  if (!pos.slTriggerPx || pos.slTriggerPx <= 0) return null;
  if (currentPx <= 0) return null;

  const isLong = pos.direction === "LONG";
  // LONG: stop altta, distance = (current - stop) / current × 100
  // SHORT: stop üstte, distance = (stop - current) / current × 100
  const dist = isLong
    ? currentPx - pos.slTriggerPx
    : pos.slTriggerPx - currentPx;
  return (dist / currentPx) * 100;
}

/**
 * Holding süresi (ms → human readable kategori).
 * UI tarafı bu kategoriden i18n string seçer.
 */
export type HoldingDurationCategory =
  | "lessThanHour"
  | "hours"
  | "day"
  | "days"
  | "week";

export function categorizeHoldingDuration(
  cTime: number,
  now: number = Date.now(),
): { category: HoldingDurationCategory; hours: number } {
  const hours = Math.max(0, (now - cTime) / (1000 * 60 * 60));
  let category: HoldingDurationCategory;
  if (hours < 1) category = "lessThanHour";
  else if (hours < 24) category = "hours";
  else if (hours < 48) category = "day";
  else if (hours < 168) category = "days";
  else category = "week";
  return { category, hours };
}
