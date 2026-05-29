/**
 * ATR — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6495-6504.
 *
 * KRİTİK NOT: Bu fonksiyon klasik Wilder smoothing kullanmaz, SADECE
 * son n True Range değerinin BASİT ortalamasını alır. Bu bilinçli bir
 * tasarım kararı — ATRPercentile ile tutarlı kalmak için aynı tarzda.
 *
 * Wilder ATR ile karıştırma — sayısal değerler farklı çıkar.
 */

import type { Candle } from "@/types/candle";

export interface AtrOptions {
  period?: number;
}

export function atr(
  candles: readonly Candle[],
  options: AtrOptions = {},
): number | null {
  const n = options.period ?? 14;
  if (n <= 0 || !Number.isFinite(n)) {
    throw new Error(`atr: geçersiz period: ${n}`);
  }
  if (candles.length < n + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    const pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const recent = trs.slice(-n);
  let sum = 0;
  for (let i = 0; i < recent.length; i++) sum += recent[i];
  return sum / n;
}

/**
 * True Range serisini ayrıca döndürür — ATRPercentile gibi modüllerde
 * tekrar hesap yapmamak için.
 */
export function trueRangeSeries(candles: readonly Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    const pc = candles[i - 1].c;
    out.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return out;
}
