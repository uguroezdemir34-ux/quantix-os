/**
 * PULLBACK ENGINE — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 7595-7666.
 *
 * "Trend continuation" tipi setup'lar için dedektör. Klasik motor 3TF aligned +
 * RSI sağlıklı + BB orta istiyor; trend ortasındaki düzeltmelerde (pullback) bu
 * şartlar geçmiyor. Pullback motoru: trend kanıtlandı + fiyat geri çekildi +
 * RSI cool-down + hacim canlanıyor → trende katılım fırsatı.
 *
 * 8 ŞART (HEPSI birden):
 *   1. 4H trend güçlü:    px4 > ema50_4h (LONG); px4 < ema50_4h (SHORT)
 *   2. 4H ADX ≥ 22:       trend gerçek (sadece momentum dalgası değil)
 *   3. Pullback teyit:    1H fiyat son 8 mumda ema50_1h veya ema21_1h'ye ±%1 yakın
 *   4. RSI cool-down:     LONG için 38-52, SHORT için 48-62
 *   5. Hacim canlanması:  son 3 mum hacim ortalaması > son 8 mum hacim ortalaması
 *   6. Sweep traps yok:   15m sweep ters yönde DEĞİL
 *   7. F&G ≥ 25:          panik rejimi DEĞİL (aşırı korku → bull pullback'lar yalan)
 *   8. baseScore ≥ 65:    minimum kalite
 *
 * TETİKLENDİĞİNDE:
 *   - signalType = 'pullback' (klasik 'classic' yerine)
 *   - pullbackThreshold = 72 (klasik 80 yerine — orchestrator uygular)
 *   - Tüm hard blocks aynen çalışır (counter-trend, BTC korelasyon, VWAP 2σ, vs.)
 *
 * MOTİVASYON: Literatür — pullback win-rate %60+, breakout %45. Trend
 * kanıtlandı + geri çekilme + kalite teyit ile klasik motorun yüksek
 * baseline'ına ihtiyaç duymaz.
 */

import type { Direction } from "./direction";
import type { SweepInput } from "./scorers";

export interface PullbackInput {
  direction: Direction;
  // Fiyat & EMA'lar
  px4h: number;
  ema50_4h: number | null;
  ema50_1h: number | null;
  ema21_1h: number | null;
  // Son 8 1H mum kapanışları (en yenisi sonda)
  closes1h: readonly number[];
  // 1H hacim verisi (en yenisi sonda) — son 11 mum
  volumes1h: readonly number[];
  // İndikatörler
  adx4h: number | null;
  rsi1h: number | null;
  // Sweep durumu (paket #5b'den)
  sweep15m: SweepInput;
  // Macro & quality
  fg: number;
  baseScore: number;
}

export type SignalType = "classic" | "pullback";

export interface PullbackResult {
  active: boolean;
  signalType: SignalType;
  reason: string | null;
  /** Hangi şartlar tetikledi/kaçırdı (UI/debug için) */
  diagnostics?: {
    trend4hOK: boolean;
    adx4hOK: boolean;
    pullbackTouch: boolean;
    rsiOK: boolean;
    volReviving: boolean;
    sweepAgainst: boolean;
    fgOK: boolean;
    baseOK: boolean;
  };
}

const PULLBACK_CONSTANTS = {
  ADX_MIN: 22,
  PULLBACK_LOOKBACK_BARS: 8,
  PULLBACK_DISTANCE_PCT: 1.0,
  RSI_LONG_MIN: 38,
  RSI_LONG_MAX: 52,
  RSI_SHORT_MIN: 48,
  RSI_SHORT_MAX: 62,
  VOL_RECENT_BARS: 3,
  VOL_BASE_BARS: 8,
  FG_MIN: 25,
  BASE_SCORE_MIN: 65,
  PULLBACK_THRESHOLD: 72,
} as const;

export { PULLBACK_CONSTANTS };

/**
 * Pullback setup dedektörü — saf fonksiyon.
 *
 * @returns active=true → signalType='pullback', orchestrator goThreshold=72 uygular
 *          active=false + reason → "pullback geometrisi var ama X şart kaçtı" bilgi
 *          active=false + reason=null → pullback hiç tetiklenmedi (default)
 */
export function detectPullbackSetup(input: PullbackInput): PullbackResult {
  const {
    direction,
    px4h,
    ema50_4h,
    ema50_1h,
    ema21_1h,
    closes1h,
    volumes1h,
    adx4h,
    rsi1h,
    sweep15m,
    fg,
    baseScore,
  } = input;

  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";

  // Önkoşullar — bunlar olmadan hesaplama yapılamaz (sessiz çıkış)
  if (!(isLong || isShort)) {
    return { active: false, signalType: "classic", reason: null };
  }
  if (ema50_4h === null || adx4h === null || rsi1h === null) {
    return { active: false, signalType: "classic", reason: null };
  }
  if (ema50_1h === null || ema21_1h === null) {
    return { active: false, signalType: "classic", reason: null };
  }
  if (!closes1h || closes1h.length < PULLBACK_CONSTANTS.PULLBACK_LOOKBACK_BARS) {
    return { active: false, signalType: "classic", reason: null };
  }

  // 1. 4H trend güçlü
  const trend4hOK = isLong ? px4h > ema50_4h : px4h < ema50_4h;

  // 2. 4H ADX ≥ 22
  const adx4hOK = adx4h >= PULLBACK_CONSTANTS.ADX_MIN;

  // 3. Pullback teyit — son 8 1H mumda EMA50 veya EMA21'e ±%1 yakına geldi mi?
  let pullbackTouch = false;
  const recent8 = closes1h.slice(-PULLBACK_CONSTANTS.PULLBACK_LOOKBACK_BARS);
  for (const c of recent8) {
    const dist50 = (Math.abs(c - ema50_1h) / ema50_1h) * 100;
    const dist21 = (Math.abs(c - ema21_1h) / ema21_1h) * 100;
    if (
      dist50 <= PULLBACK_CONSTANTS.PULLBACK_DISTANCE_PCT ||
      dist21 <= PULLBACK_CONSTANTS.PULLBACK_DISTANCE_PCT
    ) {
      pullbackTouch = true;
      break;
    }
  }

  // 4. RSI cool-down
  const rsiOK = isLong
    ? rsi1h >= PULLBACK_CONSTANTS.RSI_LONG_MIN &&
      rsi1h <= PULLBACK_CONSTANTS.RSI_LONG_MAX
    : rsi1h >= PULLBACK_CONSTANTS.RSI_SHORT_MIN &&
      rsi1h <= PULLBACK_CONSTANTS.RSI_SHORT_MAX;

  // 5. Hacim canlanması — son 3 mum vs son 8 mum (3 öncesi)
  let volReviving = false;
  if (
    volumes1h &&
    volumes1h.length >=
      PULLBACK_CONSTANTS.VOL_RECENT_BARS + PULLBACK_CONSTANTS.VOL_BASE_BARS
  ) {
    const total = volumes1h.length;
    const recent3Slice = volumes1h.slice(total - PULLBACK_CONSTANTS.VOL_RECENT_BARS);
    const base8Slice = volumes1h.slice(
      total - PULLBACK_CONSTANTS.VOL_RECENT_BARS - PULLBACK_CONSTANTS.VOL_BASE_BARS,
      total - PULLBACK_CONSTANTS.VOL_RECENT_BARS,
    );
    const recent3 = recent3Slice.reduce((s, v) => s + (v || 0), 0) /
      PULLBACK_CONSTANTS.VOL_RECENT_BARS;
    const base8 = base8Slice.reduce((s, v) => s + (v || 0), 0) /
      PULLBACK_CONSTANTS.VOL_BASE_BARS;
    if (base8 > 0 && recent3 / base8 > 1.0) volReviving = true;
  }

  // 6. Sweep traps — ters yön sweep var mı?
  const sweepAgainst =
    (isLong && sweep15m.type === "bearish_sweep") ||
    (isShort && sweep15m.type === "bullish_sweep");

  // 7. F&G panik değil
  const fgOK = fg >= PULLBACK_CONSTANTS.FG_MIN;

  // 8. baseScore minimum
  const baseOK = baseScore >= PULLBACK_CONSTANTS.BASE_SCORE_MIN;

  const diagnostics = {
    trend4hOK,
    adx4hOK,
    pullbackTouch,
    rsiOK,
    volReviving,
    sweepAgainst,
    fgOK,
    baseOK,
  };

  // Tüm 8 şart sağlandı mı?
  if (
    trend4hOK &&
    adx4hOK &&
    pullbackTouch &&
    rsiOK &&
    volReviving &&
    !sweepAgainst &&
    fgOK &&
    baseOK
  ) {
    return {
      active: true,
      signalType: "pullback",
      reason:
        `🔄 Pullback setup · 4H trend ✓ (ADX ${adx4h.toFixed(0)}) · ` +
        `RSI ${rsi1h.toFixed(0)} cool · Hacim canlandı · F&G ${fg}`,
      diagnostics,
    };
  }

  // Pullback geometrisi var ama bir şart kaçırıldı — bilgi mesajı
  if (trend4hOK && adx4hOK && pullbackTouch) {
    const missing: string[] = [];
    if (!rsiOK) missing.push(`RSI ${rsi1h.toFixed(0)} cool zone dışı`);
    if (!volReviving) missing.push("hacim sönük");
    if (sweepAgainst) missing.push("ters sweep");
    if (!fgOK) missing.push(`F&G ${fg} (panik)`);
    if (!baseOK) missing.push(`baseScore ${baseScore}<65`);
    if (missing.length > 0) {
      return {
        active: false,
        signalType: "classic",
        reason: `🔄 Pullback geometrisi var ama: ${missing.join(", ")} → tetiklenmedi`,
        diagnostics,
      };
    }
  }

  return { active: false, signalType: "classic", reason: null, diagnostics };
}
