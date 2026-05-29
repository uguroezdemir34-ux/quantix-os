/**
 * ADAPTIVE TP — ADX-adaptif Take Profit hesabı.
 *
 * Kaynak: panel_v55_51.html satır 4763-4788 (computeAdaptiveTPs).
 *
 * ADX'e göre 3 mod:
 *   - ADX < 25 (zayıf): 2.0× / 3.0× ATR (hızlı çıkış)
 *   - 25 ≤ ADX < 35 (sağlıklı): 2.5× / 4.0× ATR
 *   - ADX ≥ 35 (güçlü): 3.0× / 5.0× ATR (uzun hedef)
 *   - ADX null → healthy_fallback (2.5× / 4.0×)
 */

import type { Direction } from "@/lib/score/orchestrator";
import type { TpResult } from "./types";

const ADX_WEAK_BELOW = 25;
const ADX_STRONG_ABOVE = 35;

export function computeAdaptiveTPs(
  direction: Direction,
  px: number,
  atr: number,
  adx1h: number | null,
): TpResult {
  if (direction === "NEUTRAL") {
    return {
      tp1Price: px,
      tp2Price: px,
      tp1Mult: 0,
      tp2Mult: 0,
      mode: "healthy_fallback",
      label: "NEUTRAL — TP yok",
    };
  }

  const isLong = direction === "LONG";

  let tp1Mult: number;
  let tp2Mult: number;
  let mode: TpResult["mode"];
  let label: string;

  if (adx1h === null || adx1h === undefined) {
    tp1Mult = 2.5;
    tp2Mult = 4.0;
    mode = "healthy_fallback";
    label = "Sağlıklı (ADX yok, varsayılan)";
  } else if (adx1h < ADX_WEAK_BELOW) {
    tp1Mult = 2.0;
    tp2Mult = 3.0;
    mode = "weak";
    label = `Zayıf trend (ADX ${adx1h.toFixed(0)}, hızlı çıkış)`;
  } else if (adx1h >= ADX_STRONG_ABOVE) {
    tp1Mult = 3.0;
    tp2Mult = 5.0;
    mode = "strong";
    label = `Güçlü trend (ADX ${adx1h.toFixed(0)}, uzun hedef)`;
  } else {
    tp1Mult = 2.5;
    tp2Mult = 4.0;
    mode = "healthy";
    label = `Sağlıklı trend (ADX ${adx1h.toFixed(0)})`;
  }

  return {
    tp1Price: isLong ? px + tp1Mult * atr : px - tp1Mult * atr,
    tp2Price: isLong ? px + tp2Mult * atr : px - tp2Mult * atr,
    tp1Mult,
    tp2Mult,
    mode,
    label,
  };
}
