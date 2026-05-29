/**
 * LIQUIDITY SWEEP DETECTION — v2 YENİ ÖZELLİK
 *
 * Panel v55.51'de mevcut değil. Sektör standardı pattern:
 *   Wyckoff (1930)        → "Spring" (LONG) / "Upthrust" (SHORT)
 *   Raschke (1995)        → "Turtle Soup" reversal setup
 *   ICT/SMC (2010+)       → "Liquidity Grab" / "Stop Hunt"
 *
 * Tanım: Önceki swing level'ın üzerinden geçen ama ondan SONRA ters yöne
 * kapanan bar — "stoplar alındı, akıllı para giriyor" yorumu.
 *
 * MANTIK:
 *   LONG sweep  → önceki swing LOW'un altına inildi, kapanış swing low ÜSTÜNDE
 *   SHORT sweep → önceki swing HIGH'ın üstüne çıkıldı, kapanış swing high ALTINDA
 *
 * GÜCÜ ARTIRAN FAKTÖRLER (bonus puan):
 *   - Engulfing kapanış (barın açılışını da geçti)  → +5 ekstra
 *   - 4H pivot'tan (1H pivot'tan daha güvenilir)    → +5 ekstra
 *   - Wick oranı yüksek (en az %50 fitil)           → temel gereksinim
 *
 * SAVUNMA:
 *   - Penetration min %0.05: gürültü filtresi
 *   - Penetration max %2.0: gerçek breakout'tan ayırmak için
 *   - Sadece son 3 mum: eski sweep'ler skor için irrelevant
 *
 * KORUMA: `enabled` parametre ile kapatılabilir. Kapalıyken null döner,
 * panel davranışı bozulmaz.
 */

import type { Candle } from "@/types/candle";
import { findAllSwingHighs, findAllSwingLows } from "./swing";

export type SweepDirection = "LONG" | "SHORT";

export interface SweepDetection {
  direction: SweepDirection;
  /** Sweep edilen seviye fiyatı */
  level: number;
  /** Sweep'i yapan barın idx'i (candle dizisinde) */
  barIdx: number;
  /** Penetration yüzdesi (level'ı ne kadar geçti) */
  penetrationPct: number;
  /** Barın wick oranı (0-1, ne kadarı fitil) */
  wickRatio: number;
  /** Engulfing close mu? (kapanış açılıştan ters yönde geçti) */
  engulfing: boolean;
  /** 4H pivot mu yoksa 1H pivot mu? (4H daha güvenilir) */
  source: "4h" | "1h";
  /** Toplam skor bonusu (5/10/15/20) */
  scoreBonus: number;
}

export interface SweepOptions {
  /** Feature toggle — false ise null döner (mevcut davranışı koru) */
  enabled?: boolean;
  /** Min penetration %, default 0.05 */
  minPenetrationPct?: number;
  /** Max penetration %, default 2.0 (üstü gerçek breakout) */
  maxPenetrationPct?: number;
  /** Min wick oranı (0-1), default 0.5 */
  minWickRatio?: number;
  /** Sweep aramasına dahil edilen son mum sayısı, default 3 */
  recencyBars?: number;
}

const DEFAULTS = {
  enabled: true,
  minPenetrationPct: 0.05,
  maxPenetrationPct: 2.0,
  minWickRatio: 0.5,
  recencyBars: 3,
} as const;

/**
 * Bir bar için sweep kontrolü.
 * @returns SweepDetection veya null (sweep yok)
 */
function checkBarForSweep(
  bar: Candle,
  barIdx: number,
  swingLevel: number,
  swingType: "high" | "low",
  source: "4h" | "1h",
  opts: Required<SweepOptions>,
): SweepDetection | null {
  const barRange = bar.h - bar.l;
  if (barRange <= 0) return null;

  if (swingType === "high") {
    // SHORT sweep: bar HIGH > swing high (penetration), bar CLOSE < swing high
    const penetrationAbs = bar.h - swingLevel;
    if (penetrationAbs <= 0) return null;
    if (bar.c >= swingLevel) return null; // ters yöne kapanmadı

    const penetrationPct = (penetrationAbs / swingLevel) * 100;
    if (penetrationPct < opts.minPenetrationPct) return null;
    if (penetrationPct > opts.maxPenetrationPct) return null;

    // Wick oranı: üst wick / total range
    const upperWick = bar.h - Math.max(bar.o, bar.c);
    const wickRatio = upperWick / barRange;
    if (wickRatio < opts.minWickRatio) return null;

    // Engulfing: kapanış açılışın altında AND açılış level'in üstünde
    const engulfing = bar.c < bar.o && bar.o > swingLevel;

    let scoreBonus = 5;
    if (engulfing) scoreBonus += 5;
    if (source === "4h") scoreBonus += 5;

    return {
      direction: "SHORT",
      level: swingLevel,
      barIdx,
      penetrationPct,
      wickRatio,
      engulfing,
      source,
      scoreBonus,
    };
  }

  // swingType === 'low'
  // LONG sweep: bar LOW < swing low, bar CLOSE > swing low
  const penetrationAbs = swingLevel - bar.l;
  if (penetrationAbs <= 0) return null;
  if (bar.c <= swingLevel) return null;

  const penetrationPct = (penetrationAbs / swingLevel) * 100;
  if (penetrationPct < opts.minPenetrationPct) return null;
  if (penetrationPct > opts.maxPenetrationPct) return null;

  const lowerWick = Math.min(bar.o, bar.c) - bar.l;
  const wickRatio = lowerWick / barRange;
  if (wickRatio < opts.minWickRatio) return null;

  const engulfing = bar.c > bar.o && bar.o < swingLevel;

  let scoreBonus = 5;
  if (engulfing) scoreBonus += 5;
  if (source === "4h") scoreBonus += 5;

  return {
    direction: "LONG",
    level: swingLevel,
    barIdx,
    penetrationPct,
    wickRatio,
    engulfing,
    source,
    scoreBonus,
  };
}

/**
 * Verilen 1H mum serisinde liquidity sweep ara.
 *
 * @param k1h Aranacak 1H mum serisi (en az son birkaç bar dolu olmalı)
 * @param k4h 4H mumlar (daha güvenilir pivot kaynağı için)
 * @param options Feature toggle ve eşikler
 * @returns Bulunan en iyi sweep (en yüksek skor bonus); yoksa null
 */
export function detectLiquiditySweep(
  k1h: readonly Candle[],
  k4h: readonly Candle[],
  options: SweepOptions = {},
): SweepDetection | null {
  const opts: Required<SweepOptions> = { ...DEFAULTS, ...options };
  if (!opts.enabled) return null;
  if (!k1h || k1h.length < 10) return null;

  // Sweep'i yapan bar pivot oluşturan bardan SONRA olmalı.
  // Sadece son N bar içinde sweep arıyoruz.
  // Bu son barlar pivot olarak SAYILMAZ (çünkü findAllSwing... sağ n bar
  // doğrulaması ister, son barlar bu doğrulamayı geçemez).
  // Yani pivot'lar zaten son N bar HARİÇİNDEN gelir.
  const pivots4hHigh = findAllSwingHighs(k4h, 60, 3, 5);
  const pivots4hLow = findAllSwingLows(k4h, 60, 3, 5);
  const pivots1hHigh = findAllSwingHighs(k1h, 80, 3, 8);
  const pivots1hLow = findAllSwingLows(k1h, 80, 3, 8);

  const detections: SweepDetection[] = [];

  // Son N barı tara
  const startIdx = Math.max(0, k1h.length - opts.recencyBars);
  for (let i = startIdx; i < k1h.length; i++) {
    const bar = k1h[i];

    // 4H pivot'lara karşı kontrol
    for (const piv of pivots4hHigh) {
      const det = checkBarForSweep(bar, i, piv.price, "high", "4h", opts);
      if (det) detections.push(det);
    }
    for (const piv of pivots4hLow) {
      const det = checkBarForSweep(bar, i, piv.price, "low", "4h", opts);
      if (det) detections.push(det);
    }
    // 1H pivot'lara karşı kontrol
    // Pivot kendisi son N bardan ÖNCE olmalı (kendini sweep edemez)
    const oldestRecencyIdx = startIdx;
    for (const piv of pivots1hHigh) {
      if (piv.idx >= oldestRecencyIdx) continue;
      const det = checkBarForSweep(bar, i, piv.price, "high", "1h", opts);
      if (det) detections.push(det);
    }
    for (const piv of pivots1hLow) {
      if (piv.idx >= oldestRecencyIdx) continue;
      const det = checkBarForSweep(bar, i, piv.price, "low", "1h", opts);
      if (det) detections.push(det);
    }
  }

  if (detections.length === 0) return null;

  // En yüksek skor bonus + en yeni bar
  detections.sort((a, b) => {
    if (b.scoreBonus !== a.scoreBonus) return b.scoreBonus - a.scoreBonus;
    return b.barIdx - a.barIdx;
  });
  return detections[0];
}

// Test ve diğer modüller için constants
export const SWEEP_CONSTANTS = {
  MIN_PENETRATION_PCT: DEFAULTS.minPenetrationPct,
  MAX_PENETRATION_PCT: DEFAULTS.maxPenetrationPct,
  MIN_WICK_RATIO: DEFAULTS.minWickRatio,
  RECENCY_BARS: DEFAULTS.recencyBars,
  BONUS_BASE: 5,
  BONUS_ENGULFING: 5,
  BONUS_4H_SOURCE: 5,
  MAX_BONUS: 15,
} as const;
