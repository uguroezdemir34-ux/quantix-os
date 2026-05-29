/**
 * DIRECTION INFERENCE — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 7277-7297.
 *
 * 3 timeframe (4H + 1H + 15m) EMA-bazlı yön kararı:
 *   - 3 TF agree → LONG/SHORT, dirConfidence = 3
 *   - 4H + 1H agree (15m yok veya farklı) → LONG/SHORT, dirConfidence = 2
 *   - Diğer → NEUTRAL, dirConfidence = 0
 *
 * 1H için ekstra: ema50_1h > ema200_1h (yoksa kabul) — yapı teyidi.
 *
 * Bu, score motoru ile sweep entegrasyonun da kullandığı temel modül.
 */

export type Direction = "LONG" | "SHORT" | "NEUTRAL";

export interface DirectionInput {
  px15: number;
  px1h: number;
  px4h: number;
  ema21_15m: number | null;
  ema50_1h: number | null;
  ema200_1h: number | null;
  ema50_4h: number | null;
}

export interface DirectionResult {
  direction: Direction;
  /** 0-3 — kaç timeframe uyumlu */
  confidence: number;
}

export function inferDirection(input: DirectionInput): DirectionResult {
  const { px15, px1h, px4h, ema21_15m, ema50_1h, ema200_1h, ema50_4h } = input;

  // 15m verisi varsa 3-TF kontrolü
  if (ema50_4h !== null && ema50_1h !== null && ema21_15m !== null) {
    const trend4hUp = px4h > ema50_4h;
    const trend1hUp =
      px1h > ema50_1h && (ema200_1h !== null ? ema50_1h > ema200_1h : true);
    const trend15mUp = px15 > ema21_15m;
    const trend4hDown = px4h < ema50_4h;
    const trend1hDown =
      px1h < ema50_1h && (ema200_1h !== null ? ema50_1h < ema200_1h : true);
    const trend15mDown = px15 < ema21_15m;

    if (trend4hUp && trend1hUp && trend15mUp)
      return { direction: "LONG", confidence: 3 };
    if (trend4hUp && trend1hUp)
      return { direction: "LONG", confidence: 2 };
    if (trend4hDown && trend1hDown && trend15mDown)
      return { direction: "SHORT", confidence: 3 };
    if (trend4hDown && trend1hDown)
      return { direction: "SHORT", confidence: 2 };
    return { direction: "NEUTRAL", confidence: 0 };
  }

  // 15m yok — 2-TF fallback
  if (ema50_4h !== null && ema50_1h !== null) {
    if (px4h > ema50_4h && px1h > ema50_1h)
      return { direction: "LONG", confidence: 2 };
    if (px4h < ema50_4h && px1h < ema50_1h)
      return { direction: "SHORT", confidence: 2 };
  }

  return { direction: "NEUTRAL", confidence: 0 };
}
