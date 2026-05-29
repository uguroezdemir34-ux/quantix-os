/**
 * S/R LEVEL HELPERS — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6627-6691.
 *
 * Üç fonksiyon:
 *   getPrevPeriodLevels(candles4h) → PDH/PDL/PWH/PWL
 *   getRoundNumberLevels(currentPrice) → 3 yuvarlak seviye
 *   calculateLevelStrength(candles, levelPrice, side) → kaç kez test edildi
 *
 * Panel davranışı (KORUNDU):
 *   - 4H mum: 6 mum=1 gün, 42 mum=1 hafta (24h/4h=6, 7×6=42)
 *   - Round step: 10000+ → 1000, 1000+ → 100, vb.
 *   - Level strength: ±0.5% tolerans, en az 3 bar gap (aynı dokunuş tekrar sayılmaz)
 */

import type { Candle } from "@/types/candle";

export type LevelType = "PDH" | "PDL" | "PWH" | "PWL" | "ROUND";

export interface PeriodLevel {
  price: number;
  type: LevelType;
}

/**
 * Önceki gün/hafta high-low seviyelerini döndürür.
 * 4H mumlardan türetilir (6 mum = 1 gün, 42 mum = 1 hafta).
 *
 * Panel `getPrevPeriodLevels` ile birebir (satır 6627-6652).
 */
export function getPrevPeriodLevels(candles4h: readonly Candle[]): PeriodLevel[] {
  const out: PeriodLevel[] = [];

  // Önceki gün (son 12 mum içinde 6-12 aralığı = önceki tam gün)
  if (candles4h && candles4h.length >= 12) {
    const start = candles4h.length - 12;
    const end = candles4h.length - 6;
    let h = -Infinity;
    let l = Infinity;
    for (let i = start; i < end; i++) {
      if (candles4h[i].h > h) h = candles4h[i].h;
      if (candles4h[i].l < l) l = candles4h[i].l;
    }
    out.push({ price: h, type: "PDH" });
    out.push({ price: l, type: "PDL" });
  }

  // Önceki hafta
  if (candles4h && candles4h.length >= 84) {
    const start = candles4h.length - 84;
    const end = candles4h.length - 42;
    let h = -Infinity;
    let l = Infinity;
    for (let i = start; i < end; i++) {
      if (candles4h[i].h > h) h = candles4h[i].h;
      if (candles4h[i].l < l) l = candles4h[i].l;
    }
    out.push({ price: h, type: "PWH" });
    out.push({ price: l, type: "PWL" });
  }
  return out;
}

/**
 * Yuvarlak sayı (psikolojik) seviyeler.
 * Panel `getRoundNumberLevels` ile birebir (satır 6655-6669).
 *
 * Step hesabı (fiyat aralıklarına göre):
 *   > 10000 → 1000   (BTC tier)
 *   > 1000  → 100    (ETH tier)
 *   > 100   → 10     (orta fiyat)
 *   > 10    → 1
 *   > 1     → 0.1
 *   diğer   → 0.01
 *
 * 3 seviye döner: alt, alt+step, alt-step (max 0).
 */
export function getRoundNumberLevels(currentPrice: number): PeriodLevel[] {
  let step: number;
  if (currentPrice > 10000) step = 1000;
  else if (currentPrice > 1000) step = 100;
  else if (currentPrice > 100) step = 10;
  else if (currentPrice > 10) step = 1;
  else if (currentPrice > 1) step = 0.1;
  else step = 0.01;

  const lower = Math.floor(currentPrice / step) * step;
  return [
    { price: lower, type: "ROUND" },
    { price: lower + step, type: "ROUND" },
    { price: Math.max(0, lower - step), type: "ROUND" },
  ];
}

export type LevelSide = "resistance" | "support";

/**
 * Bir fiyat seviyesinin kaç kez test edildiğini hesapla.
 * Toleransa giren her dokunuş, son dokunuştan en az 3 bar uzakta olmalı
 * (aynı consolidation içindeki ardışık temaslar tek dokunuş sayılır).
 *
 * Panel `calculateLevelStrength` ile birebir (satır 6672-6691).
 *
 * @param candles Test edilecek mumlar (genelde 1H)
 * @param levelPrice Test edilen fiyat seviyesi
 * @param side resistance → high'a bakılır; support → low'a bakılır
 * @returns en az 1, en fazla touches sayısı
 */
export function calculateLevelStrength(
  candles: readonly Candle[],
  levelPrice: number,
  side: LevelSide,
): number {
  if (!candles || candles.length < 5 || !levelPrice) return 1;
  let touches = 0;
  let lastTouchIdx = -999;
  const tol = levelPrice * 0.005;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    let touched = false;
    if (side === "resistance") {
      if (Math.abs(c.h - levelPrice) <= tol) touched = true;
    } else {
      if (Math.abs(c.l - levelPrice) <= tol) touched = true;
    }
    if (touched && i - lastTouchIdx >= 3) {
      touches++;
      lastTouchIdx = i;
    }
  }
  return Math.max(1, touches);
}
