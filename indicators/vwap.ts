/**
 * VWAP — Daily Anchored, v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6911-6940.
 *
 * Bugünün UTC 00:00'dan itibaren olan 1H mumlar üzerinden hesaplanır.
 * Hiç bugünkü mum yoksa son 24 muma fallback.
 *
 * KRİTİK: Volume-weighted standard deviation (1 sigma bands).
 *
 * Test edilebilirlik: `now` parametre olarak verilebilir. Bunsuz `new Date()`
 * çağrılır — testlerde fake timer ya da explicit now kullan.
 */

import type { Candle } from "@/types/candle";

export interface VwapResult {
  vwap: number;
  upperBand: number;
  lowerBand: number;
  pctFromVwap: number;
  stddev: number;
}

export function vwap(
  candles1h: readonly Candle[],
  now: Date = new Date(),
): VwapResult | null {
  if (!candles1h || candles1h.length < 3) return null;

  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  let bars = candles1h.filter((c) => c.t !== undefined && c.t >= todayUTC);
  if (bars.length < 2) bars = candles1h.slice(-24);
  if (bars.length < 2) return null;

  let cumPV = 0;
  let cumV = 0;
  const typPrices: Array<{ tp: number; v: number }> = [];
  for (const c of bars) {
    const tp = (c.h + c.l + c.c) / 3;
    const v = c.v || 1;
    cumPV += tp * v;
    cumV += v;
    typPrices.push({ tp, v });
  }
  if (cumV === 0) return null;

  const vwapValue = cumPV / cumV;

  let varSum = 0;
  for (const { tp, v } of typPrices) {
    varSum += v * Math.pow(tp - vwapValue, 2);
  }
  const stddev = Math.sqrt(varSum / cumV);
  const upperBand = vwapValue + stddev;
  const lowerBand = vwapValue - stddev;
  const lastPx = bars[bars.length - 1].c;
  const pctFromVwap = ((lastPx - vwapValue) / vwapValue) * 100;

  return {
    vwap: vwapValue,
    upperBand,
    lowerBand,
    pctFromVwap,
    stddev,
  };
}
