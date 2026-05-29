/**
 * Volume Ratio — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6945-6953.
 *
 * Son `recentN` mumun ortalama hacmini, ondan önceki `lookback` mumun
 * ortalama hacmiyle karşılaştırır.
 *
 * Yorum (panelden): > 1.5x güçlü onay, < 0.5x ölü piyasa.
 */

import type { Candle } from "@/types/candle";

export interface VolumeRatioOptions {
  lookback?: number;
  recentN?: number;
}

export function volumeRatio(
  candles: readonly Candle[],
  options: VolumeRatioOptions = {},
): number | null {
  const lookback = options.lookback ?? 20;
  const recentN = options.recentN ?? 3;

  if (!candles || candles.length < lookback + recentN) return null;

  const recent = candles.slice(-recentN);
  const baseline = candles.slice(-(lookback + recentN), -recentN);

  let recentSum = 0;
  for (const c of recent) recentSum += c.v || 0;
  const recentAvg = recentSum / recent.length;

  let baseSum = 0;
  for (const c of baseline) baseSum += c.v || 0;
  const baseAvg = baseSum / baseline.length;

  if (baseAvg === 0) return null;
  return recentAvg / baseAvg;
}
