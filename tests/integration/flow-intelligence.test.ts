/**
 * DIVERGENCE + LIQUIDATION MAP + FLOW INTELLIGENCE TESTS
 *
 * detectDivergence:
 *   - Boş trade → neutral (yetersiz fiyat verisi)
 *   - Fiyat + CVD aynı yön → none (uyumlu)
 *   - Fiyat yukarı + CVD aşağı → bearish_divergence
 *   - Fiyat aşağı + CVD yukarı → bullish_divergence
 *   - Hareket gürültü seviyesinde → neutral
 *   - BTC/ETH CVD min eşiği farkı
 *
 * detectMultiFrameDivergence:
 *   - 5m + 15m aynı divergence → confluence=true
 *   - Farklı → confluence=false, confluenceType="none"
 *   - Boş trade → confluence=false
 *
 * buildLiquidationMap:
 *   - Boş candle → boş levels
 *   - currentPrice=0 → boş map
 *   - Veri varsa levels > 0, long/short her ikisi mevcut
 *
 * liquidationScoreAdjustment:
 *   - nearestLongLiq/ShortLiq null → adj=0
 *   - LONG + shortLiq yakın+güçlü → adj=+3
 *   - LONG + longLiq yakın+güçlü → adj=-3
 *   - SHORT mirror
 *   - Yakın magnet yok → adj=0
 *
 * enrichWithFlowIntelligence:
 *   - trades=0 + candles=0 → bypass (adj=0, vetoed=false)
 *   - totalAdjustment clamp ±15
 *   - pair/direction pass-through
 *   - vetoed=true hızlı çıkış
 *
 * applyFlowAdjustment:
 *   - vetoed=true → adjustedScore=0, adjustedConfidence=0
 *   - normal: adjustedScore = clamp(0-100, base+adj)
 *   - adjustedScore overflow clamp (base=95+adj=+15 → 100)
 *   - adjustedScore underflow clamp (base=5+adj=-15 → 0)
 *   - adjustedConfidence clamp (0-1)
 */

import { describe, it, expect } from "vitest";
import {
  detectDivergence,
  detectMultiFrameDivergence,
} from "@/lib/orderflow/divergence";
import {
  buildLiquidationMap,
  liquidationScoreAdjustment,
  type LiquidationMap,
  type LiquidationLevel,
} from "@/lib/orderflow/liquidationMap";
import {
  enrichWithFlowIntelligence,
  applyFlowAdjustment,
} from "@/lib/orderflow/flowIntelligence";
import type { Trade } from "@/lib/orderflow/types";
import type { Candle } from "@/lib/orderflow/smc";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const W5M = 5 * 60_000;
const W15M = 15 * 60_000;

let _id = 0;
function makeTrade(
  side: "buy" | "sell",
  notionalUsd: number,
  ts: number,
  price = 50000,
): Trade {
  return {
    tradeId: `t${++_id}`,
    pair: "BTC",
    timestamp: ts,
    price,
    size: notionalUsd / price,
    notionalUsd,
    side,
  };
}

/**
 * Fiyat yukarı + CVD aşağı (bearish divergence):
 * - Eski fiyat düşük, yeni fiyat yüksek → priceChangePct > 0
 * - Hacimli sell trade → CVD < 0
 */
function makeBearishDivTrades(window = W5M): Trade[] {
  const trades: Trade[] = [];
  // Eski trade: düşük fiyat, buy (CVD yukarı katkı az)
  trades.push(makeTrade("buy", 50_000, NOW - window + 1000, 50000));
  // Yeni trade: yüksek fiyat + büyük sell
  trades.push(makeTrade("sell", 500_000, NOW - 1000, 50300));
  return trades;
}

/**
 * Fiyat aşağı + CVD yukarı (bullish divergence):
 * - Eski fiyat yüksek, yeni fiyat düşük → priceChangePct < 0
 * - Büyük buy → CVD > 0
 */
function makeBullishDivTrades(window = W5M): Trade[] {
  const trades: Trade[] = [];
  trades.push(makeTrade("sell", 50_000, NOW - window + 1000, 50300));
  trades.push(makeTrade("buy", 500_000, NOW - 1000, 50000));
  return trades;
}

function makeCandle(close: number, volume = 100, ts = NOW): Candle {
  return {
    open: close - 10,
    high: close + 20,
    low: close - 20,
    close,
    volume,
    time: ts,
  };
}

function makeCandles(count: number, basePrice = 50000): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandle(basePrice + i * 10, 1000, NOW - (count - i) * 3600_000),
  );
}

// ─────────────────────────────────────────────────────────────
// detectDivergence
// ─────────────────────────────────────────────────────────────

describe("detectDivergence()", () => {
  it("boş trade → neutral (yetersiz fiyat verisi)", () => {
    const r = detectDivergence("BTC", [], W5M, NOW);
    expect(r.type).toBe("neutral");
    expect(r.humanReason).toContain("Yetersiz");
  });

  it("tek trade → neutral (oldest = newest, no change)", () => {
    const trades = [makeTrade("buy", 100_000, NOW - 1000)];
    const r = detectDivergence("BTC", trades, W5M, NOW);
    expect(r.type).toBe("neutral");
  });

  it("fiyat yukarı + CVD yukarı (büyük buy) → none (uyumlu)", () => {
    const trades = [
      makeTrade("buy", 50_000, NOW - W5M + 1000, 50000),
      makeTrade("buy", 500_000, NOW - 1000, 50300),
    ];
    const r = detectDivergence("BTC", trades, W5M, NOW);
    expect(r.type).toBe("none");
  });

  it("fiyat yukarı + büyük sell → bearish_divergence", () => {
    const r = detectDivergence("BTC", makeBearishDivTrades(W5M), W5M, NOW);
    expect(r.type).toBe("bearish_divergence");
    expect(r.priceChangePct).toBeGreaterThan(0);
    expect(r.cvdUsd).toBeLessThan(0);
  });

  it("fiyat aşağı + büyük buy → bullish_divergence", () => {
    const r = detectDivergence("BTC", makeBullishDivTrades(W5M), W5M, NOW);
    expect(r.type).toBe("bullish_divergence");
    expect(r.priceChangePct).toBeLessThan(0);
    expect(r.cvdUsd).toBeGreaterThan(0);
  });

  it("windowMs pass-through", () => {
    const r = detectDivergence("BTC", [], W15M, NOW);
    expect(r.windowMs).toBe(W15M);
  });

  it("humanReason boş değil", () => {
    const r = detectDivergence("BTC", makeBearishDivTrades(), W5M, NOW);
    expect(r.humanReason.length).toBeGreaterThan(0);
  });

  it("pencere dışı trade → ignored (neutral çıkar)", () => {
    // Trade NOW - W5M - 1ms dışında → pencere içinde yok
    const trades = [makeTrade("sell", 500_000, NOW - W5M - 1)];
    const r = detectDivergence("BTC", trades, W5M, NOW);
    expect(r.type).toBe("neutral");
  });
});

// ─────────────────────────────────────────────────────────────
// detectMultiFrameDivergence
// ─────────────────────────────────────────────────────────────

describe("detectMultiFrameDivergence()", () => {
  it("boş trade → confluence=false, confluenceType='none'", () => {
    const r = detectMultiFrameDivergence("BTC", [], NOW);
    expect(r.confluence).toBe(false);
    expect(r.confluenceType).toBe("none");
  });

  it("pair pass-through", () => {
    const r = detectMultiFrameDivergence("ETH", [], NOW);
    expect(r.pair).toBe("ETH");
  });

  it("d5m ve d15m her ikisinde bearish → confluence=true", () => {
    // 15m penceresi için daha eski tradelar da gerekiyor
    const trades = [
      // 15m penceresinde: eski fiyat düşük, yeni fiyat yüksek + sell
      makeTrade("buy", 30_000, NOW - W15M + 2000, 50000),
      makeTrade("sell", 600_000, NOW - 1000, 50500),
    ];
    const r = detectMultiFrameDivergence("BTC", trades, NOW);
    // Her iki pencerede de fiyat yukarı + CVD aşağı → bearish confluence
    if (r.d5m.type === "bearish_divergence" && r.d15m.type === "bearish_divergence") {
      expect(r.confluence).toBe(true);
      expect(r.confluenceType).toBe("bearish_divergence");
    } else {
      // Veri yetersizse neutral — confluence olmaz
      expect(r.confluence).toBe(false);
    }
  });

  it("d5m neutral, d15m bearish → confluence=false", () => {
    // Sadece 15m penceresinde veri var (5m'de yeterli değil)
    const trades = [
      makeTrade("buy", 30_000, NOW - W15M + 2000, 50000),
      makeTrade("sell", 600_000, NOW - W5M - 1000, 50500),
    ];
    const r = detectMultiFrameDivergence("BTC", trades, NOW);
    expect(r.confluence).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// buildLiquidationMap
// ─────────────────────────────────────────────────────────────

describe("buildLiquidationMap()", () => {
  it("boş candle → levels=[], nearestLongLiq=null", () => {
    const r = buildLiquidationMap("BTC", [], 50000);
    expect(r.levels).toHaveLength(0);
    expect(r.nearestLongLiq).toBeNull();
    expect(r.nearestShortLiq).toBeNull();
    expect(r.magnetZones).toHaveLength(0);
  });

  it("currentPrice=0 → boş map", () => {
    const r = buildLiquidationMap("BTC", makeCandles(10), 0);
    expect(r.levels).toHaveLength(0);
  });

  it("yeterli candle → levels > 0", () => {
    const r = buildLiquidationMap("BTC", makeCandles(20), 50000);
    expect(r.levels.length).toBeGreaterThan(0);
  });

  it("pair + currentPrice pass-through", () => {
    const r = buildLiquidationMap("ETH", makeCandles(20), 3000);
    expect(r.pair).toBe("ETH");
    expect(r.currentPrice).toBe(3000);
  });

  it("levels long ve short içeriyor", () => {
    const r = buildLiquidationMap("BTC", makeCandles(20), 50000);
    const hasLong = r.levels.some((l) => l.side === "long");
    const hasShort = r.levels.some((l) => l.side === "short");
    expect(hasLong).toBe(true);
    expect(hasShort).toBe(true);
  });

  it("intensity pozitif", () => {
    const r = buildLiquidationMap("BTC", makeCandles(20), 50000);
    expect(r.levels.every((l) => l.intensity >= 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// liquidationScoreAdjustment
// ─────────────────────────────────────────────────────────────

function makeEmptyLiqMap(currentPrice = 50000): LiquidationMap {
  return {
    pair: "BTC",
    currentPrice,
    levels: [],
    nearestLongLiq: null,
    nearestShortLiq: null,
    magnetZones: [],
  };
}

function makeLevel(price: number, side: "long" | "short", intensity = 1.0): LiquidationLevel {
  return {
    price,
    side,
    intensity,
    contributingTiers: 2,
    estimatedEntryPrice: 50000,
    label: `${side} liq ${price}`,
  };
}

describe("liquidationScoreAdjustment()", () => {
  it("nearestLongLiq=null, nearestShortLiq=null → adj=0", () => {
    const r = liquidationScoreAdjustment(makeEmptyLiqMap(), "LONG");
    expect(r.adjustment).toBe(0);
  });

  it("LONG + shortLiq yakın (%1.5) + güçlü → adj=+3", () => {
    const map = {
      ...makeEmptyLiqMap(50000),
      nearestShortLiq: makeLevel(50750, "short", 1.0), // +1.5% — yakın
    };
    const r = liquidationScoreAdjustment(map, "LONG");
    expect(r.adjustment).toBe(3);
    expect(r.reason).toContain("Short liq magnet");
  });

  it("LONG + longLiq yakın (%1.5) + güçlü → adj=-3 (riskli)", () => {
    const map = {
      ...makeEmptyLiqMap(50000),
      nearestLongLiq: makeLevel(49250, "long", 1.0), // -1.5% — yakın
    };
    const r = liquidationScoreAdjustment(map, "LONG");
    expect(r.adjustment).toBe(-3);
    expect(r.reason).toContain("RİSKLİ");
  });

  it("SHORT + longLiq yakın → adj=+3 (fiyat aşağı çekiliyor)", () => {
    const map = {
      ...makeEmptyLiqMap(50000),
      nearestLongLiq: makeLevel(49250, "long", 1.0),
    };
    const r = liquidationScoreAdjustment(map, "SHORT");
    expect(r.adjustment).toBe(3);
  });

  it("SHORT + shortLiq yakın → adj=-3 (riskli)", () => {
    const map = {
      ...makeEmptyLiqMap(50000),
      nearestShortLiq: makeLevel(50750, "short", 1.0),
    };
    const r = liquidationScoreAdjustment(map, "SHORT");
    expect(r.adjustment).toBe(-3);
  });

  it("shortLiq uzak (>%2) → adj=0", () => {
    const map = {
      ...makeEmptyLiqMap(50000),
      nearestShortLiq: makeLevel(51100, "short", 1.0), // +2.2% — uzak
    };
    const r = liquidationScoreAdjustment(map, "LONG");
    expect(r.adjustment).toBe(0);
  });

  it("intensity düşük (<0.5) → adj=0 (güçsüz magnet)", () => {
    const map = {
      ...makeEmptyLiqMap(50000),
      nearestShortLiq: makeLevel(50750, "short", 0.3), // yakın ama zayıf
    };
    const r = liquidationScoreAdjustment(map, "LONG");
    expect(r.adjustment).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// enrichWithFlowIntelligence
// ─────────────────────────────────────────────────────────────

describe("enrichWithFlowIntelligence()", () => {
  it("trades=0 + candles=0 → bypass, adj=0, vetoed=false", () => {
    const r = enrichWithFlowIntelligence("BTC", "LONG", [], [], 50000, undefined, NOW);
    expect(r.totalAdjustment).toBe(0);
    expect(r.vetoed).toBe(false);
    expect(r.confidenceMultiplier).toBe(1.0);
    expect(r.vetoReason).toBeNull();
  });

  it("pair + direction pass-through", () => {
    const r = enrichWithFlowIntelligence("ETH", "SHORT", [], [], 3000, undefined, NOW);
    expect(r.pair).toBe("ETH");
    expect(r.signalDirection).toBe("SHORT");
  });

  it("totalAdjustment clamp ±15 üst sınır", () => {
    // En iyi senaryo bile ±15'i aşamaz
    const trades = Array.from({ length: 50 }, (_, i) =>
      makeTrade("buy", 50_000, NOW - i * 10_000),
    );
    const r = enrichWithFlowIntelligence("BTC", "LONG", trades, makeCandles(20), 50000, undefined, NOW);
    expect(r.totalAdjustment).toBeLessThanOrEqual(15);
    expect(r.totalAdjustment).toBeGreaterThanOrEqual(-15);
  });

  it("confidenceMultiplier 0.4-1.6 arasında", () => {
    const r = enrichWithFlowIntelligence("BTC", "LONG", [], [], 50000, undefined, NOW);
    expect(r.confidenceMultiplier).toBeGreaterThanOrEqual(0.4);
    expect(r.confidenceMultiplier).toBeLessThanOrEqual(1.6);
  });

  it("smc ve liqMap alanları tanımlı", () => {
    const r = enrichWithFlowIntelligence("BTC", "LONG", [], [], 50000, undefined, NOW);
    expect(r.smc).toBeDefined();
    expect(r.liqMap).toBeDefined();
    expect(r.flowVerdict).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// applyFlowAdjustment
// ─────────────────────────────────────────────────────────────

function makeFlowResult(overrides: Partial<ReturnType<typeof enrichWithFlowIntelligence>> = {}) {
  return {
    pair: "BTC" as const,
    signalDirection: "LONG" as const,
    flowVerdict: {} as ReturnType<typeof enrichWithFlowIntelligence>["flowVerdict"],
    smc: { pair: "BTC" as const, orderBlocks: [], liquidityGrabs: [], fairValueGaps: [], recentEvents: [] },
    liqMap: makeEmptyLiqMap(),
    totalAdjustment: 5,
    confidenceMultiplier: 1.2,
    vetoed: false,
    vetoReason: null,
    reasons: [],
    humanSummary: "ok",
    ...overrides,
  };
}

describe("applyFlowAdjustment()", () => {
  it("vetoed=true → adjustedScore=0, adjustedConfidence=0", () => {
    const flow = makeFlowResult({ vetoed: true, vetoReason: "bearish div" });
    const r = applyFlowAdjustment(80, 0.8, flow);
    expect(r.adjustedScore).toBe(0);
    expect(r.adjustedConfidence).toBe(0);
    expect(r.vetoed).toBe(true);
    expect(r.vetoReason).toBe("bearish div");
  });

  it("normal: adjustedScore = base + adj", () => {
    const flow = makeFlowResult({ totalAdjustment: 5 });
    const r = applyFlowAdjustment(80, 0.8, flow);
    expect(r.adjustedScore).toBe(85);
    expect(r.baseScore).toBe(80);
    expect(r.flowAdjustment).toBe(5);
  });

  it("negatif adjustment", () => {
    const flow = makeFlowResult({ totalAdjustment: -8 });
    const r = applyFlowAdjustment(75, 0.8, flow);
    expect(r.adjustedScore).toBe(67);
  });

  it("üst clamp: base=95 + adj=+15 → 100", () => {
    const flow = makeFlowResult({ totalAdjustment: 15 });
    const r = applyFlowAdjustment(95, 1.0, flow);
    expect(r.adjustedScore).toBe(100);
  });

  it("alt clamp: base=5 + adj=-15 → 0", () => {
    const flow = makeFlowResult({ totalAdjustment: -15 });
    const r = applyFlowAdjustment(5, 1.0, flow);
    expect(r.adjustedScore).toBe(0);
  });

  it("adjustedConfidence = clamp(0-1, base × multiplier)", () => {
    const flow = makeFlowResult({ confidenceMultiplier: 1.5 });
    const r = applyFlowAdjustment(80, 0.7, flow);
    expect(r.adjustedConfidence).toBeCloseTo(Math.min(1, 0.7 * 1.5), 5);
  });

  it("confidence üst clamp → max 1.0", () => {
    const flow = makeFlowResult({ confidenceMultiplier: 1.6 });
    const r = applyFlowAdjustment(80, 0.9, flow);
    expect(r.adjustedConfidence).toBeLessThanOrEqual(1.0);
  });

  it("vetoed=false → vetoReason null", () => {
    const r = applyFlowAdjustment(80, 0.8, makeFlowResult());
    expect(r.vetoed).toBe(false);
    expect(r.vetoReason).toBeNull();
  });
});
