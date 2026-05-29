/**
 * Relative Strength Index (RSI) — Wilder's smoothing yöntemi.
 *
 * v55.x paneldeki JS implementasyonun TypeScript portu. Davranış birebir aynı
 * kalmalı; aksi takdirde Faz 3 paralel doğrulamada sapma çıkar.
 *
 * Tasarım kararları:
 *   1. Saf fonksiyon — yan etki yok, DOM/localStorage'a dokunmuyor.
 *   2. Period parametre, varsayılan 14 (Wilder standard).
 *   3. closes[] kronolojik sıralı (en eski [0], en yeni [n-1]).
 *   4. Yetersiz veri → null. Eski paneldeki "0" döndürme alışkanlığı bug üretiyordu;
 *      tip sistemiyle bu kategoride hataları yakalıyoruz.
 *   5. Tek değer (son bar) yerine tüm seri istenirse rsiSeries() kullanılır.
 */

export interface RsiOptions {
  /** Wilder periyodu, varsayılan 14. */
  period?: number;
}

/**
 * Tek bir RSI değeri döndürür (en son bar için).
 * Yetersiz veri (kapanış sayısı <= period) durumunda null.
 */
export function rsi(closes: readonly number[], options: RsiOptions = {}): number | null {
  const period = options.period ?? 14;

  if (period <= 0 || !Number.isFinite(period)) {
    throw new Error(`rsi: geçersiz period değeri: ${period}`);
  }
  if (closes.length <= period) {
    return null;
  }

  // İlk period bar için basit ortalama (Wilder başlangıcı).
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain += diff;
    } else {
      avgLoss += -diff;
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Sonraki barlar için Wilder smoothing.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    // Hiç düşüş yoksa RSI tanım gereği 100.
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Her bar için RSI değeri içeren bir dizi döndürür.
 * İlk `period` eleman null (yetersiz veri).
 * Grafik çizimi ve backtest için kullanılır.
 */
export function rsiSeries(
  closes: readonly number[],
  options: RsiOptions = {},
): (number | null)[] {
  const period = options.period ?? 14;
  const out: (number | null)[] = new Array(closes.length).fill(null);

  if (closes.length <= period) {
    return out;
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}
