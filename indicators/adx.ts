/**
 * ADX (Average Directional Index) — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6850-6905.
 *
 * Wilder smoothing burada özel bir tarzda kullanılıyor:
 *   - İç wilderSmooth() fonksiyonu ortalama DEĞİL, SMOOTHED SUM döndürür:
 *     first = sum of first n; next = prev - prev/n + value.
 *   - Bu özel olarak doğru çünkü +DI/-DI = 100 * smoothedDM / smoothedTR,
 *     ve oranda /n kısalır — sum versiyonu kullanmak matematiksel olarak
 *     aynı sonucu üretir (smTR ve smDM aynı şekilde işlendiği sürece).
 *   - ADX, DX serisinin klasik Wilder smoothed averaged versiyonudur
 *     (toplam değil, ortalama — kodda da öyle).
 *
 * Returns: { adx, plusDI, minusDI }
 */

import type { Candle } from "@/types/candle";

export interface AdxResult {
  adx: number;
  plusDI: number;
  minusDI: number;
}

function wilderSmoothSum(arr: readonly number[], period: number): number[] | null {
  if (arr.length < period) return null;
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += arr[i];
  out.push(sum);
  for (let i = period; i < arr.length; i++) {
    sum = sum - sum / period + arr[i];
    out.push(sum);
  }
  return out;
}

export function adx(
  candles: readonly Candle[],
  period = 14,
): AdxResult | null {
  const n = period;
  if (candles.length < n * 2 + 1) return null;

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    const pc = candles[i - 1].c;
    const ph = candles[i - 1].h;
    const pl = candles[i - 1].l;

    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const upMove = h - ph;
    const downMove = pl - l;

    let plusDM = 0;
    let minusDM = 0;
    if (upMove > downMove && upMove > 0) plusDM = upMove;
    if (downMove > upMove && downMove > 0) minusDM = downMove;

    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  const smTR = wilderSmoothSum(trs, n);
  const smPlusDM = wilderSmoothSum(plusDMs, n);
  const smMinusDM = wilderSmoothSum(minusDMs, n);
  if (!smTR || !smPlusDM || !smMinusDM) return null;

  const dxs: number[] = [];
  for (let i = 0; i < smTR.length; i++) {
    if (smTR[i] === 0) {
      dxs.push(0);
      continue;
    }
    const plusDI = (100 * smPlusDM[i]) / smTR[i];
    const minusDI = (100 * smMinusDM[i]) / smTR[i];
    const sumDI = plusDI + minusDI;
    const dx = sumDI === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sumDI;
    dxs.push(dx);
  }
  if (dxs.length < n) return null;

  // ADX = klasik Wilder smoothed average of DX
  let adxSum = 0;
  for (let i = 0; i < n; i++) adxSum += dxs[i];
  let adxValue = adxSum / n;
  for (let i = n; i < dxs.length; i++) {
    adxValue = (adxValue * (n - 1) + dxs[i]) / n;
  }

  const lastIdx = smTR.length - 1;
  const plusDI =
    smTR[lastIdx] === 0 ? 0 : (100 * smPlusDM[lastIdx]) / smTR[lastIdx];
  const minusDI =
    smTR[lastIdx] === 0 ? 0 : (100 * smMinusDM[lastIdx]) / smTR[lastIdx];

  return { adx: adxValue, plusDI, minusDI };
}
