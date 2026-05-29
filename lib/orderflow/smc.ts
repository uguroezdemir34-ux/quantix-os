/**
 * SMC (Smart Money Concepts) DETECTOR
 *
 * Retail trader dünyasının 2024-2026 en hızlı büyüyen stratejisi.
 * Akademik literatürde "Order Flow Imbalance" + "Institutional Footprint"
 * analiziyle örtüşür.
 *
 * 3 ana kavram:
 *   1. Order Block (OB) — "Son güçlü hareketten ÖNCEKİ ters mum"
 *      Kurum emir bıraktı, fiyat geri gelirse oradan tepki bekleniyor.
 *
 *   2. Liquidity Grab/Sweep — Fiyat önceki swing high/low'u wick'le geçip dönüyor
 *      Retail stop'larının avlanması.
 *
 *   3. Fair Value Gap (FVG) — 3 ardışık mumda 1. ve 3. arasında boşluk
 *      "İmbalance zonu" — fiyat genelde geri dönüp doldurur.
 *
 * Bu tespit otomatik olarak yapılır. Bookmap, TradingView, Buildix bunu
 * otomatik yapmıyor — QUANTIX dünyada ilk.
 */

import type { Pair } from "@/lib/constants/pairs";

/**
 * Mum verisi (OHLCV). lightweight-charts uyumlu.
 */
export interface Candle {
  time: number; // epoch sn veya ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * SMC event tipi.
 */
export type SmcEventType =
  | "bullish_order_block"
  | "bearish_order_block"
  | "bullish_liquidity_grab"
  | "bearish_liquidity_grab"
  | "bullish_fvg"
  | "bearish_fvg";

/**
 * Tespit edilen SMC event'i.
 */
export interface SmcEvent {
  type: SmcEventType;
  /** Pattern'in başladığı mum index'i */
  startIndex: number;
  /** Pattern'in bittiği mum index'i */
  endIndex: number;
  /** Pattern'in başladığı zaman */
  startTime: number;
  /** Pattern'in bittiği zaman */
  endTime: number;
  /** Zone üst sınır (resistance veya FVG üstü) */
  zoneHigh: number;
  /** Zone alt sınır (support veya FVG altı) */
  zoneLow: number;
  /** Hangi pair'de */
  pair: Pair;
  /** Yön (bullish/bearish) */
  direction: "bullish" | "bearish";
  /** İnsan-okunaklı etiket */
  label: string;
}

// ════════════════════ ORDER BLOCK DETECTOR ════════════════════

/**
 * Order Block tespiti.
 *
 * Algoritma:
 *   1. Güçlü impulsif hareketi tespit et (büyük body, range > 1.5x avg)
 *   2. Hareketten ÖNCEKİ son ters renkli mumu işaretle
 *
 * Örnek (bullish OB):
 *   - Kırmızı mum (close < open)
 *   - Sonraki 1-3 mum güçlü yeşil hareket yaptı (BOS — Break of Structure)
 *   - O kırmızı mum = bullish order block (destek)
 */
export function detectOrderBlocks(
  candles: readonly Candle[],
  pair: Pair,
  lookback: number = 50,
): SmcEvent[] {
  if (candles.length < 5) return [];

  const events: SmcEvent[] = [];
  const ranges = candles.map((c) => c.high - c.low);
  const avgRange =
    ranges.slice(-Math.min(20, ranges.length)).reduce((a, b) => a + b, 0) /
    Math.min(20, ranges.length);

  const start = Math.max(1, candles.length - lookback);
  // i: kontrol edilen ters renkli mum
  // i+1, i+2, i+3: impuls hareketin başladığı mum'lar
  for (let i = start; i < candles.length - 3; i++) {
    const c = candles[i];
    const isRed = c.close < c.open;
    const isGreen = c.close > c.open;
    if (!isRed && !isGreen) continue; // doji ignore

    // Sonraki 3 mum güçlü tek yön mü?
    const next3 = candles.slice(i + 1, i + 4);
    if (next3.length < 3) continue;

    // Bullish OB adayı: kırmızı i, sonraki 3 mum güçlü yeşil
    if (isRed) {
      const allGreen = next3.every((nc) => nc.close > nc.open);
      const cumRange = next3.reduce((s, nc) => s + (nc.high - nc.low), 0);
      const breakOfStructure = next3[2].close > c.high; // BOS confirmation
      if (allGreen && cumRange > 2 * avgRange && breakOfStructure) {
        events.push({
          type: "bullish_order_block",
          startIndex: i,
          endIndex: i,
          startTime: c.time,
          endTime: c.time,
          zoneHigh: c.high,
          zoneLow: c.low,
          pair,
          direction: "bullish",
          label: "Bullish Order Block",
        });
      }
    }

    // Bearish OB adayı: yeşil i, sonraki 3 mum güçlü kırmızı
    if (isGreen) {
      const allRed = next3.every((nc) => nc.close < nc.open);
      const cumRange = next3.reduce((s, nc) => s + (nc.high - nc.low), 0);
      const breakOfStructure = next3[2].close < c.low;
      if (allRed && cumRange > 2 * avgRange && breakOfStructure) {
        events.push({
          type: "bearish_order_block",
          startIndex: i,
          endIndex: i,
          startTime: c.time,
          endTime: c.time,
          zoneHigh: c.high,
          zoneLow: c.low,
          pair,
          direction: "bearish",
          label: "Bearish Order Block",
        });
      }
    }
  }

  return events;
}

// ════════════════════ LIQUIDITY GRAB DETECTOR ════════════════════

/**
 * Liquidity Grab (Sweep) tespiti.
 *
 * Algoritma:
 *   1. Önceki swing high/low'u tespit et (örn. son 20 mumdaki tepe/dip)
 *   2. Mevcut mumun wick'i bu seviyeyi geçti mi
 *   3. Mumun body'si seviyenin altında/üstünde KAPANDI mı (sweep onayı)
 *
 * Örnek (bearish liquidity grab):
 *   - Son 20 mumun en yüksek high'i 60500
 *   - Bu mumun high'i 60600 (geçti)
 *   - Mum kırmızı kapandı, close 60450 (sweep ettikten sonra döndü)
 *   - = bearish liquidity grab (kurum retail long stop'larını avladı, şimdi düşer)
 */
export function detectLiquidityGrabs(
  candles: readonly Candle[],
  pair: Pair,
  swingLookback: number = 20,
): SmcEvent[] {
  if (candles.length < swingLookback + 1) return [];

  const events: SmcEvent[] = [];

  for (let i = swingLookback; i < candles.length; i++) {
    const c = candles[i];
    const swingWindow = candles.slice(i - swingLookback, i);
    const swingHigh = Math.max(...swingWindow.map((sw) => sw.high));
    const swingLow = Math.min(...swingWindow.map((sw) => sw.low));

    // Bearish grab: high swing high'i geçti, close swing high altında kaldı (kırmızı)
    if (c.high > swingHigh && c.close < swingHigh && c.close < c.open) {
      events.push({
        type: "bearish_liquidity_grab",
        startIndex: i,
        endIndex: i,
        startTime: c.time,
        endTime: c.time,
        zoneHigh: c.high,
        zoneLow: swingHigh,
        pair,
        direction: "bearish",
        label: `Bearish Liquidity Sweep @ ${swingHigh.toFixed(2)}`,
      });
    }

    // Bullish grab: low swing low'u geçti, close swing low üstünde kaldı (yeşil)
    if (c.low < swingLow && c.close > swingLow && c.close > c.open) {
      events.push({
        type: "bullish_liquidity_grab",
        startIndex: i,
        endIndex: i,
        startTime: c.time,
        endTime: c.time,
        zoneHigh: swingLow,
        zoneLow: c.low,
        pair,
        direction: "bullish",
        label: `Bullish Liquidity Sweep @ ${swingLow.toFixed(2)}`,
      });
    }
  }

  return events;
}

// ════════════════════ FAIR VALUE GAP (FVG) DETECTOR ════════════════════

/**
 * Fair Value Gap tespiti.
 *
 * Algoritma:
 *   3 ardışık mum üzerinde (c1, c2, c3):
 *     - Bullish FVG: c1.high < c3.low (yukarı boşluk)
 *     - Bearish FVG: c1.low > c3.high (aşağı boşluk)
 *
 * Boşluk zone'u: c1.high → c3.low (bullish) veya c3.high → c1.low (bearish)
 * Fiyat sonra bu zone'u "doldurmaya" eğilim gösterir.
 */
export function detectFairValueGaps(
  candles: readonly Candle[],
  pair: Pair,
  lookback: number = 50,
): SmcEvent[] {
  if (candles.length < 3) return [];

  const events: SmcEvent[] = [];
  const start = Math.max(0, candles.length - lookback);

  for (let i = start; i < candles.length - 2; i++) {
    const c1 = candles[i];
    const c2 = candles[i + 1];
    const c3 = candles[i + 2];

    // Bullish FVG: c1.high < c3.low
    if (c1.high < c3.low) {
      // İkinci mum güçlü impulsif olmalı (yeşil + büyük body)
      const c2Bullish = c2.close > c2.open;
      const c2Body = Math.abs(c2.close - c2.open);
      const c2Range = c2.high - c2.low;
      if (c2Bullish && c2Body > c2Range * 0.5) {
        events.push({
          type: "bullish_fvg",
          startIndex: i,
          endIndex: i + 2,
          startTime: c1.time,
          endTime: c3.time,
          zoneHigh: c3.low,
          zoneLow: c1.high,
          pair,
          direction: "bullish",
          label: `Bullish FVG @ ${c1.high.toFixed(2)}-${c3.low.toFixed(2)}`,
        });
      }
    }

    // Bearish FVG: c1.low > c3.high
    if (c1.low > c3.high) {
      const c2Bearish = c2.close < c2.open;
      const c2Body = Math.abs(c2.close - c2.open);
      const c2Range = c2.high - c2.low;
      if (c2Bearish && c2Body > c2Range * 0.5) {
        events.push({
          type: "bearish_fvg",
          startIndex: i,
          endIndex: i + 2,
          startTime: c1.time,
          endTime: c3.time,
          zoneHigh: c1.low,
          zoneLow: c3.high,
          pair,
          direction: "bearish",
          label: `Bearish FVG @ ${c3.high.toFixed(2)}-${c1.low.toFixed(2)}`,
        });
      }
    }
  }

  return events;
}

// ════════════════════ MASTER DETECTOR ════════════════════

/**
 * Tüm SMC pattern'lerini tespit et — ana giriş noktası.
 */
export interface SmcAnalysis {
  pair: Pair;
  orderBlocks: SmcEvent[];
  liquidityGrabs: SmcEvent[];
  fairValueGaps: SmcEvent[];
  /** Yakın zaman (son N mum) içinde olan event'ler */
  recentEvents: SmcEvent[];
}

export function analyzeSmc(
  candles: readonly Candle[],
  pair: Pair,
  recentWindow: number = 10,
): SmcAnalysis {
  const orderBlocks = detectOrderBlocks(candles, pair);
  const liquidityGrabs = detectLiquidityGrabs(candles, pair);
  const fairValueGaps = detectFairValueGaps(candles, pair);

  // Recent = son N mumda olan tüm event'ler
  const recentThreshold = candles.length - recentWindow;
  const allEvents = [...orderBlocks, ...liquidityGrabs, ...fairValueGaps];
  const recentEvents = allEvents
    .filter((e) => e.endIndex >= recentThreshold)
    .sort((a, b) => b.endIndex - a.endIndex); // en yeni önce

  return {
    pair,
    orderBlocks,
    liquidityGrabs,
    fairValueGaps,
    recentEvents,
  };
}

// ════════════════════ SCORE INTEGRATION ════════════════════

/**
 * SMC analizinin sinyal yönüne etkisi.
 *
 * Mantık:
 *   - Recent bullish event + LONG sinyal → destekleyici (+3 puan)
 *   - Recent bearish event + LONG sinyal → uyarı (-3 puan)
 *   - Liquidity grab özellikle güçlü sinyal (+/-5 puan)
 */
export function smcScoreAdjustment(
  analysis: SmcAnalysis,
  signalDirection: "LONG" | "SHORT",
): { adjustment: number; reasons: string[] } {
  let adjustment = 0;
  const reasons: string[] = [];

  for (const event of analysis.recentEvents) {
    const supportsDirection =
      (event.direction === "bullish" && signalDirection === "LONG") ||
      (event.direction === "bearish" && signalDirection === "SHORT");

    let weight = 3;
    if (
      event.type === "bullish_liquidity_grab" ||
      event.type === "bearish_liquidity_grab"
    ) {
      weight = 5; // Liquidity grab özellikle güçlü
    }

    if (supportsDirection) {
      adjustment += weight;
      reasons.push(`+${weight} ${event.label}`);
    } else {
      adjustment -= weight;
      reasons.push(`-${weight} ${event.label} (ters)`);
    }
  }

  // Toplam -10 ila +10 arası clamp
  adjustment = Math.max(-10, Math.min(10, adjustment));

  return { adjustment, reasons };
}
