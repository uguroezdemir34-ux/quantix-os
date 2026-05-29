/**
 * Bollinger Bands — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6412-6423.
 *
 * KRİTİK: Population variance (`/n`) kullanılır, sample variance (`/n-1`) DEĞİL.
 * Çoğu istatistik kütüphanesi sample variance kullanır — port ederken dikkat.
 *
 * Returns: { upper, lower, mean, pct, sd }
 *   pct: (price - lower) / (upper - lower), 0-1 normal aralık,
 *        >1 → üst banttan yukarı, <0 → alt banttan aşağı (squeeze/break sinyali).
 */

export interface BbResult {
  upper: number;
  lower: number;
  mean: number;
  pct: number;
  sd: number;
}

export interface BbOptions {
  period?: number;
  mult?: number;
}

export function bb(
  closes: readonly number[],
  options: BbOptions = {},
): BbResult | null {
  const n = options.period ?? 20;
  const mult = options.mult ?? 2;
  if (n <= 0 || !Number.isFinite(n)) {
    throw new Error(`bb: geçersiz period: ${n}`);
  }
  if (closes.length < n) return null;

  const recent = closes.slice(-n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += recent[i];
  const mean = sum / n;

  let varianceSum = 0;
  for (let i = 0; i < n; i++) {
    varianceSum += (recent[i] - mean) ** 2;
  }
  // Population variance (panel ile birebir).
  const variance = varianceSum / n;
  const sd = Math.sqrt(variance);

  const upper = mean + mult * sd;
  const lower = mean - mult * sd;
  const price = closes[closes.length - 1];
  const pct = (price - lower) / (upper - lower);

  return { upper, lower, mean, pct, sd };
}
