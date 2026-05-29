/**
 * SWING LEVEL DETECTION — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6565-6624.
 *
 * Üç fonksiyon:
 *   findSwingLevels(candles, lookback=20, n=2)  → en yakın 1 high + 1 low
 *   findAllSwingHighs(candles, lookback=60, n=3, maxCount=8) → tüm high'lar
 *   findAllSwingLows(candles, lookback=60, n=3, maxCount=8)  → tüm low'lar
 *
 * Pivot tanımı: candles[i] etrafında n bar pencere — sol n bar VE sağ n bar
 * pivot'tan strict olarak küçük (high için) veya büyük (low için).
 *
 * Panel davranışı (KORUNDU):
 *   - findSwingLevels: ">=" karşılaştırması → eşit barlar pivot'u INVALİDE eder
 *   - findAllSwingHighs/Lows: aynı ">=" / "<=" davranışı
 *   - findSwingLevels en YAKIN (en yüksek idx) pivot'u tutar
 *   - findAllSwingHighs/Lows son maxCount tane döndürür, REVERSE (yakın→uzak)
 */

import type { Candle } from "@/types/candle";

export interface SwingResult {
  swingHigh: number | null;
  swingLow: number | null;
  swingHighIdx: number;
  swingLowIdx: number;
}

export interface PivotPoint {
  price: number;
  idx: number;
}

/**
 * En yakın (en güncel) 1 swing high + 1 swing low döndürür.
 * Panel `findSwingLevels` ile birebir (satır 6565-6584).
 */
export function findSwingLevels(
  candles: readonly Candle[],
  lookback = 20,
  n = 2,
): SwingResult {
  if (!candles || candles.length < 2 * n + 1) {
    return { swingHigh: null, swingLow: null, swingHighIdx: -1, swingLowIdx: -1 };
  }
  const start = Math.max(n, candles.length - lookback - n);
  const end = candles.length - n;
  let highest: number | null = null;
  let highestIdx = -1;
  let lowest: number | null = null;
  let lowestIdx = -1;

  for (let i = start; i < end; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= n; j++) {
      if (candles[i - j].h >= h || candles[i + j].h >= h) isHigh = false;
      if (candles[i - j].l <= l || candles[i + j].l <= l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    // En son (en yakın) pivot'u tut — eski pivot'lar üzerine yaz
    if (isHigh && (highest === null || i > highestIdx)) {
      highest = h;
      highestIdx = i;
    }
    if (isLow && (lowest === null || i > lowestIdx)) {
      lowest = l;
      lowestIdx = i;
    }
  }
  return { swingHigh: highest, swingLow: lowest, swingHighIdx: highestIdx, swingLowIdx: lowestIdx };
}

/**
 * Tüm swing high pivot'larını döndürür (son maxCount tanesi, yakın→uzak sıralı).
 * Panel `findAllSwingHighs` ile birebir (satır 6594-6608).
 */
export function findAllSwingHighs(
  candles: readonly Candle[],
  lookback = 60,
  n = 3,
  maxCount = 8,
): PivotPoint[] {
  if (!candles || candles.length < 2 * n + 1) return [];
  const start = Math.max(n, candles.length - lookback - n);
  const end = candles.length - n;
  const pivots: PivotPoint[] = [];
  for (let i = start; i < end; i++) {
    const h = candles[i].h;
    let isPivot = true;
    for (let j = 1; j <= n; j++) {
      if (candles[i - j].h >= h || candles[i + j].h >= h) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push({ price: h, idx: i });
  }
  return pivots.slice(-maxCount).reverse();
}

/**
 * Tüm swing low pivot'larını döndürür.
 * Panel `findAllSwingLows` ile birebir (satır 6610-6624).
 */
export function findAllSwingLows(
  candles: readonly Candle[],
  lookback = 60,
  n = 3,
  maxCount = 8,
): PivotPoint[] {
  if (!candles || candles.length < 2 * n + 1) return [];
  const start = Math.max(n, candles.length - lookback - n);
  const end = candles.length - n;
  const pivots: PivotPoint[] = [];
  for (let i = start; i < end; i++) {
    const l = candles[i].l;
    let isPivot = true;
    for (let j = 1; j <= n; j++) {
      if (candles[i - j].l <= l || candles[i + j].l <= l) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) pivots.push({ price: l, idx: i });
  }
  return pivots.slice(-maxCount).reverse();
}
