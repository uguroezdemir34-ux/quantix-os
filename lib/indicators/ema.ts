/**
 * Exponential Moving Average — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6404-6410.
 *
 * Algoritma:
 *   1. İlk n bar için basit ortalama (seed).
 *   2. Sonraki barlar için: ema = close * k + ema_prev * (1-k), k = 2/(n+1).
 *
 * Tek değer (son bar için) döndürür. Series ister isen ema_series helper'ı kullan.
 */

export interface EmaOptions {
  /** Periyot, varsayılan yok — bilinçli zorunlu (panel API'sıyla aynı). */
  period: number;
}

export function ema(closes: readonly number[], options: EmaOptions): number | null {
  const n = options.period;
  if (n <= 0 || !Number.isFinite(n)) {
    throw new Error(`ema: geçersiz period: ${n}`);
  }
  if (closes.length < n) return null;

  const k = 2 / (n + 1);
  let value = 0;
  for (let i = 0; i < n; i++) value += closes[i];
  value /= n;

  for (let i = n; i < closes.length; i++) {
    value = closes[i] * k + value * (1 - k);
  }
  return value;
}

/**
 * Her bar için EMA değeri (ilk n-1 bar null).
 * Grafik ve backtest için.
 */
export function emaSeries(
  closes: readonly number[],
  options: EmaOptions,
): (number | null)[] {
  const n = options.period;
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < n) return out;

  const k = 2 / (n + 1);
  let value = 0;
  for (let i = 0; i < n; i++) value += closes[i];
  value /= n;
  out[n - 1] = value;

  for (let i = n; i < closes.length; i++) {
    value = closes[i] * k + value * (1 - k);
    out[i] = value;
  }
  return out;
}
