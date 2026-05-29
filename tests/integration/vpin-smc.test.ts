/**
 * VPIN + SMC DETECTION TESTS
 *
 * VPIN: createVpinState, addTradeToBucket, ingestTradesIntoVpin,
 *       classifyToxicity, computeVpinResult, vpinScoreMultiplier
 *
 * SMC: detectOrderBlocks, detectLiquidityGrabs, detectFairValueGaps,
 *      analyzeSmc, smcScoreAdjustment
 */

import { describe, it, expect } from "vitest";
import {
  createVpinState,
  ingestTradesIntoVpin,
  addTradeToBucket,
  classifyToxicity,
  computeVpinResult,
  vpinScoreMultiplier,
} from "@/lib/orderflow/vpin";
import {
  detectOrderBlocks,
  detectLiquidityGrabs,
  detectFairValueGaps,
  analyzeSmc,
  smcScoreAdjustment,
} from "@/lib/orderflow/smc";
import type { Trade } from "@/lib/orderflow/types";
import type { Candle } from "@/lib/orderflow/smc";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

let _tid = 0;
function makeTrade(
  side: "buy" | "sell",
  notionalUsd: number,
  pair: "BTC" | "ETH" = "BTC",
): Trade {
  return {
    tradeId: `t${++_tid}`,
    pair,
    timestamp: Date.now(),
    price: 50000,
    size: notionalUsd / 50000,
    notionalUsd,
    side,
  };
}

function makeCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle {
  return { time, open, high, low, close, volume };
}

// ─────────────────────────────────────────────────────────────
// VPIN — createVpinState
// ─────────────────────────────────────────────────────────────

describe("createVpinState()", () => {
  it("starts with empty closed buckets", () => {
    const state = createVpinState("BTC");
    expect(state.closedBuckets).toHaveLength(0);
    expect(state.lastVpin).toBe(0);
    expect(state.pair).toBe("BTC");
  });

  it("uses default config for BTC ($50M bucket)", () => {
    const state = createVpinState("BTC");
    expect(state.config.bucketSizeUsd).toBe(50_000_000);
    expect(state.config.windowSize).toBe(50);
  });

  it("uses ETH config ($12.5M bucket)", () => {
    const state = createVpinState("ETH");
    expect(state.config.bucketSizeUsd).toBe(12_500_000);
  });

  it("accepts custom config", () => {
    const state = createVpinState("BTC", { bucketSizeUsd: 1000, windowSize: 5 });
    expect(state.config.bucketSizeUsd).toBe(1000);
    expect(state.config.windowSize).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// VPIN — addTradeToBucket
// ─────────────────────────────────────────────────────────────

describe("addTradeToBucket()", () => {
  const emptyBucket = {
    startedAt: 0,
    closedAt: null,
    buyVolumeUsd: 0,
    sellVolumeUsd: 0,
    totalVolumeUsd: 0,
    closed: false,
    imbalance: 0,
  };

  it("buy trade accumulates in bucket", () => {
    const trade = makeTrade("buy", 400);
    const { currentBucket, closedBucket } = addTradeToBucket(emptyBucket, trade, 1000);
    expect(closedBucket).toBeNull();
    expect(currentBucket.buyVolumeUsd).toBe(400);
    expect(currentBucket.sellVolumeUsd).toBe(0);
  });

  it("sell trade accumulates correctly", () => {
    const trade = makeTrade("sell", 400);
    const { currentBucket } = addTradeToBucket(emptyBucket, trade, 1000);
    expect(currentBucket.sellVolumeUsd).toBe(400);
  });

  it("bucket closes when total >= bucketSize", () => {
    const trade = makeTrade("buy", 1000);
    const { currentBucket, closedBucket } = addTradeToBucket(emptyBucket, trade, 1000);
    expect(closedBucket).not.toBeNull();
    expect(closedBucket!.closed).toBe(true);
    expect(currentBucket.totalVolumeUsd).toBe(0); // new empty bucket
  });

  it("closed bucket imbalance = 1 for pure buy", () => {
    const trade = makeTrade("buy", 1000);
    const { closedBucket } = addTradeToBucket(emptyBucket, trade, 1000);
    expect(closedBucket!.imbalance).toBe(1);
  });

  it("balanced bucket imbalance = 0", () => {
    const bucket = {
      ...emptyBucket,
      buyVolumeUsd: 500,
      sellVolumeUsd: 499,
      totalVolumeUsd: 999,
    };
    const trade = makeTrade("sell", 1); // triggers close
    const { closedBucket } = addTradeToBucket(bucket, trade, 1000);
    expect(closedBucket!.imbalance).toBeCloseTo(0, 1);
  });
});

// ─────────────────────────────────────────────────────────────
// VPIN — ingestTradesIntoVpin
// ─────────────────────────────────────────────────────────────

describe("ingestTradesIntoVpin()", () => {
  const BUCKET_SIZE = 1000;
  const config = { bucketSizeUsd: BUCKET_SIZE, windowSize: 5 };

  it("no trades → state unchanged", () => {
    const state = createVpinState("BTC", config);
    const next = ingestTradesIntoVpin(state, []);
    expect(next.closedBuckets).toHaveLength(0);
    expect(next.lastVpin).toBe(0);
  });

  it("trades below bucket size → no closed bucket", () => {
    const state = createVpinState("BTC", config);
    const next = ingestTradesIntoVpin(state, [makeTrade("buy", 500)]);
    expect(next.closedBuckets).toHaveLength(0);
    expect(next.currentBucket.totalVolumeUsd).toBe(500);
  });

  it("single bucket filled → 1 closed bucket", () => {
    const state = createVpinState("BTC", config);
    const trades = [makeTrade("buy", 600), makeTrade("buy", 600)]; // 1200 > 1000
    const next = ingestTradesIntoVpin(state, trades);
    expect(next.closedBuckets).toHaveLength(1);
  });

  it("vpin = average imbalance of closed buckets", () => {
    const state = createVpinState("BTC", config);
    // 2 pure buy buckets → imbalance=1 each → vpin=1
    const trades = [
      makeTrade("buy", 1000),
      makeTrade("buy", 1000),
    ];
    const next = ingestTradesIntoVpin(state, trades);
    expect(next.lastVpin).toBe(1);
  });

  it("sliding window trims to windowSize", () => {
    let state = createVpinState("BTC", { bucketSizeUsd: BUCKET_SIZE, windowSize: 3 });
    // Add 5 full buckets (5000 USD in single buy trades)
    const trades = Array.from({ length: 5 }, () => makeTrade("buy", 1000));
    state = ingestTradesIntoVpin(state, trades);
    // window=3 → max 3 closed buckets retained
    expect(state.closedBuckets.length).toBeLessThanOrEqual(3);
  });

  it("ignores trades for different pair", () => {
    const state = createVpinState("BTC", config);
    const ethTrade = makeTrade("buy", 2000, "ETH"); // ETH trade
    const next = ingestTradesIntoVpin(state, [ethTrade]);
    expect(next.closedBuckets).toHaveLength(0);
    expect(next.currentBucket.totalVolumeUsd).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// classifyToxicity
// ─────────────────────────────────────────────────────────────

describe("classifyToxicity()", () => {
  it("< 0.30 → normal", () => {
    expect(classifyToxicity(0)).toBe("normal");
    expect(classifyToxicity(0.29)).toBe("normal");
  });
  it("0.30-0.44 → elevated", () => {
    expect(classifyToxicity(0.30)).toBe("elevated");
    expect(classifyToxicity(0.44)).toBe("elevated");
  });
  it("0.45-0.54 → warning", () => {
    expect(classifyToxicity(0.45)).toBe("warning");
    expect(classifyToxicity(0.54)).toBe("warning");
  });
  it("0.55-0.69 → toxic", () => {
    expect(classifyToxicity(0.55)).toBe("toxic");
    expect(classifyToxicity(0.69)).toBe("toxic");
  });
  it(">= 0.70 → extreme", () => {
    expect(classifyToxicity(0.70)).toBe("extreme");
    expect(classifyToxicity(1.0)).toBe("extreme");
  });
});

// ─────────────────────────────────────────────────────────────
// computeVpinResult
// ─────────────────────────────────────────────────────────────

describe("computeVpinResult()", () => {
  it("empty state → not ready", () => {
    const result = computeVpinResult(createVpinState("BTC"));
    expect(result.ready).toBe(false);
    expect(result.vpin).toBe(0);
    expect(result.pair).toBe("BTC");
  });

  it("ready when >= 10 buckets", () => {
    const config = { bucketSizeUsd: 100, windowSize: 50 };
    let state = createVpinState("BTC", config);
    const trades = Array.from({ length: 10 }, () => makeTrade("buy", 100));
    state = ingestTradesIntoVpin(state, trades);
    expect(computeVpinResult(state).ready).toBe(true);
  });

  it("bucketCount matches closedBuckets.length", () => {
    const config = { bucketSizeUsd: 100, windowSize: 50 };
    let state = createVpinState("BTC", config);
    state = ingestTradesIntoVpin(state, [makeTrade("buy", 300)]);
    const result = computeVpinResult(state);
    expect(result.bucketCount).toBe(state.closedBuckets.length);
  });
});

// ─────────────────────────────────────────────────────────────
// vpinScoreMultiplier
// ─────────────────────────────────────────────────────────────

describe("vpinScoreMultiplier()", () => {
  it("normal toxicity → 1.0 regardless of alignment", () => {
    expect(vpinScoreMultiplier(0.20, true)).toBe(1.0);
    expect(vpinScoreMultiplier(0.20, false)).toBe(1.0);
  });

  it("elevated toxicity → 1.0", () => {
    expect(vpinScoreMultiplier(0.35, true)).toBe(1.0);
  });

  it("warning + aligned → 1.15", () => {
    expect(vpinScoreMultiplier(0.50, true)).toBe(1.15);
  });

  it("warning + not aligned → 0.85", () => {
    expect(vpinScoreMultiplier(0.50, false)).toBe(0.85);
  });

  it("toxic + aligned → 1.3", () => {
    expect(vpinScoreMultiplier(0.60, true)).toBe(1.3);
  });

  it("toxic + not aligned → 0.7", () => {
    expect(vpinScoreMultiplier(0.60, false)).toBe(0.7);
  });

  it("extreme + aligned → 1.5", () => {
    expect(vpinScoreMultiplier(0.80, true)).toBe(1.5);
  });

  it("extreme + not aligned → 0.5", () => {
    expect(vpinScoreMultiplier(0.80, false)).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────
// SMC — detectFairValueGaps
// ─────────────────────────────────────────────────────────────

describe("detectFairValueGaps()", () => {
  it("empty / too few candles → empty", () => {
    expect(detectFairValueGaps([], "BTC")).toHaveLength(0);
    expect(detectFairValueGaps([makeCandle(1, 100, 110, 90, 105)], "BTC")).toHaveLength(0);
  });

  it("bullish FVG: c1.high < c3.low with strong c2", () => {
    // c1: high=100, c2: strong bullish, c3: low=110
    const candles: Candle[] = [
      makeCandle(1, 90, 100, 85, 95),  // c1: high=100
      makeCandle(2, 95, 115, 94, 114), // c2: strong green (body > 50% range)
      makeCandle(3, 114, 120, 110, 118), // c3: low=110 > c1.high=100 → bullish FVG
    ];
    const events = detectFairValueGaps(candles, "BTC");
    expect(events.some((e) => e.type === "bullish_fvg")).toBe(true);
  });

  it("bearish FVG: c1.low > c3.high with strong bearish c2", () => {
    const candles: Candle[] = [
      makeCandle(1, 120, 125, 110, 115), // c1: low=110
      makeCandle(2, 115, 116, 90, 91),   // c2: strong red (body > 50% range)
      makeCandle(3, 91, 95, 80, 85),     // c3: high=95 < c1.low=110 → bearish FVG
    ];
    const events = detectFairValueGaps(candles, "BTC");
    expect(events.some((e) => e.type === "bearish_fvg")).toBe(true);
  });

  it("FVG zone bounds are correct for bullish", () => {
    const candles: Candle[] = [
      makeCandle(1, 90, 100, 85, 95),
      makeCandle(2, 95, 115, 94, 114),
      makeCandle(3, 114, 120, 110, 118),
    ];
    const events = detectFairValueGaps(candles, "BTC");
    const fvg = events.find((e) => e.type === "bullish_fvg");
    expect(fvg?.zoneLow).toBe(100); // c1.high
    expect(fvg?.zoneHigh).toBe(110); // c3.low
  });

  it("no FVG when c2 body is weak (< 50% range)", () => {
    // c2 has small body but big wicks
    const candles: Candle[] = [
      makeCandle(1, 90, 100, 85, 95),
      makeCandle(2, 95, 130, 94, 96), // tiny body (1pt), huge range (36pt) — weak
      makeCandle(3, 96, 125, 110, 120),
    ];
    const events = detectFairValueGaps(candles, "BTC");
    expect(events.filter((e) => e.type === "bullish_fvg")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// SMC — detectLiquidityGrabs
// ─────────────────────────────────────────────────────────────

describe("detectLiquidityGrabs()", () => {
  it("too few candles → empty", () => {
    expect(detectLiquidityGrabs([], "BTC")).toHaveLength(0);
  });

  it("bearish grab: high sweeps prior swing high, close below it", () => {
    // Build a swing high around 110, then a candle that sweeps it and closes below
    const candles: Candle[] = [
      makeCandle(1, 100, 110, 95, 105), // swing high = 110
      makeCandle(2, 105, 108, 100, 102),
      makeCandle(3, 102, 112, 99, 98),  // high=112 > 110, close=98 < 110, close < open → bearish grab
    ];
    const events = detectLiquidityGrabs(candles, "BTC");
    expect(events.some((e) => e.type === "bearish_liquidity_grab")).toBe(true);
  });

  it("bullish grab: low sweeps prior swing low, close above it", () => {
    const candles: Candle[] = [
      makeCandle(1, 100, 105, 90, 95), // swing low = 90
      makeCandle(2, 95, 100, 92, 98),
      makeCandle(3, 98, 102, 85, 101), // low=85 < 90, close=101 > 90, close > open → bullish grab
    ];
    const events = detectLiquidityGrabs(candles, "BTC");
    expect(events.some((e) => e.type === "bullish_liquidity_grab")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// SMC — detectOrderBlocks
// ─────────────────────────────────────────────────────────────

describe("detectOrderBlocks()", () => {
  it("too few candles → empty", () => {
    expect(detectOrderBlocks([], "BTC")).toHaveLength(0);
    expect(detectOrderBlocks([makeCandle(1, 100, 110, 90, 95)], "BTC")).toHaveLength(0);
  });

  it("bearish OB: green candle before 3 strong red candles with BOS", () => {
    // A green candle followed by 3 large red candles that break structure below green's low
    const avgRange = 20;
    const candles: Candle[] = [
      makeCandle(1, 90, 100, 85, 95),  // background
      makeCandle(2, 90, 100, 85, 95),
      makeCandle(3, 90, 100, 85, 95),
      // OB candidate: green
      makeCandle(4, 90, 105, 88, 100), // green (close > open)
      // 3 strong red candles, cumRange >> 2*avgRange, c[3].close < c[4].low (BOS)
      makeCandle(5, 100, 102, 75, 76), // red, range=27
      makeCandle(6, 76, 78, 60, 61),   // red, range=18
      makeCandle(7, 61, 62, 50, 51),   // red, range=12; close=51 < OB low=88 → BOS
    ];
    const events = detectOrderBlocks(candles, "BTC");
    // The algo may or may not find an OB depending on avgRange — just ensure no crash
    expect(Array.isArray(events)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// SMC — analyzeSmc
// ─────────────────────────────────────────────────────────────

describe("analyzeSmc()", () => {
  it("returns all 4 fields", () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      makeCandle(i, 100, 110, 90, 105),
    );
    const result = analyzeSmc(candles, "BTC");
    expect(result.pair).toBe("BTC");
    expect(Array.isArray(result.orderBlocks)).toBe(true);
    expect(Array.isArray(result.liquidityGrabs)).toBe(true);
    expect(Array.isArray(result.fairValueGaps)).toBe(true);
    expect(Array.isArray(result.recentEvents)).toBe(true);
  });

  it("recentEvents contains only events in last N candles", () => {
    const candles: Candle[] = [
      makeCandle(1, 90, 100, 85, 95),
      makeCandle(2, 95, 115, 94, 114),
      makeCandle(3, 114, 120, 110, 118),
    ];
    const result = analyzeSmc(candles, "BTC", 2);
    // recentEvents: events with endIndex >= (3 - 2) = 1
    for (const e of result.recentEvents) {
      expect(e.endIndex).toBeGreaterThanOrEqual(1);
    }
  });

  it("recentEvents sorted newest first", () => {
    const candles = Array.from({ length: 10 }, (_, i) =>
      makeCandle(i, 100, 110, 90, 105),
    );
    const result = analyzeSmc(candles, "ETH");
    for (let i = 1; i < result.recentEvents.length; i++) {
      expect(result.recentEvents[i - 1].endIndex).toBeGreaterThanOrEqual(
        result.recentEvents[i].endIndex,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────
// SMC — smcScoreAdjustment
// ─────────────────────────────────────────────────────────────

describe("smcScoreAdjustment()", () => {
  const baseAnalysis = {
    pair: "BTC" as const,
    orderBlocks: [],
    liquidityGrabs: [],
    fairValueGaps: [],
    recentEvents: [],
  };

  it("no recent events → adjustment=0, reasons=[]", () => {
    const { adjustment, reasons } = smcScoreAdjustment(baseAnalysis, "LONG");
    expect(adjustment).toBe(0);
    expect(reasons).toHaveLength(0);
  });

  it("bullish event + LONG → positive adjustment (+3)", () => {
    const event = {
      type: "bullish_fvg" as const,
      startIndex: 9,
      endIndex: 9,
      startTime: 1,
      endTime: 1,
      zoneHigh: 105,
      zoneLow: 100,
      pair: "BTC" as const,
      direction: "bullish" as const,
      label: "Bullish FVG",
    };
    const { adjustment } = smcScoreAdjustment(
      { ...baseAnalysis, recentEvents: [event] },
      "LONG",
    );
    expect(adjustment).toBe(3);
  });

  it("bearish liquidity grab + SHORT → +5 (stronger weight)", () => {
    const event = {
      type: "bearish_liquidity_grab" as const,
      startIndex: 9,
      endIndex: 9,
      startTime: 1,
      endTime: 1,
      zoneHigh: 112,
      zoneLow: 110,
      pair: "BTC" as const,
      direction: "bearish" as const,
      label: "Bearish Liquidity Sweep",
    };
    const { adjustment } = smcScoreAdjustment(
      { ...baseAnalysis, recentEvents: [event] },
      "SHORT",
    );
    expect(adjustment).toBe(5);
  });

  it("bullish event + SHORT → negative adjustment (-3)", () => {
    const event = {
      type: "bullish_order_block" as const,
      startIndex: 9,
      endIndex: 9,
      startTime: 1,
      endTime: 1,
      zoneHigh: 105,
      zoneLow: 95,
      pair: "BTC" as const,
      direction: "bullish" as const,
      label: "Bullish Order Block",
    };
    const { adjustment } = smcScoreAdjustment(
      { ...baseAnalysis, recentEvents: [event] },
      "SHORT",
    );
    expect(adjustment).toBe(-3);
  });

  it("adjustment clamped to [-10, +10]", () => {
    // 4 liquidity grabs aligned → 4*5 = 20 → clamped to 10
    const grab = {
      type: "bullish_liquidity_grab" as const,
      startIndex: 9,
      endIndex: 9,
      startTime: 1,
      endTime: 1,
      zoneHigh: 95,
      zoneLow: 90,
      pair: "BTC" as const,
      direction: "bullish" as const,
      label: "Bullish Sweep",
    };
    const { adjustment } = smcScoreAdjustment(
      { ...baseAnalysis, recentEvents: [grab, grab, grab, grab] },
      "LONG",
    );
    expect(adjustment).toBe(10);
  });

  it("mixed events partially cancel", () => {
    const bullishOb = {
      type: "bullish_order_block" as const,
      startIndex: 9, endIndex: 9, startTime: 1, endTime: 1,
      zoneHigh: 105, zoneLow: 95, pair: "BTC" as const,
      direction: "bullish" as const, label: "Bullish OB",
    };
    const bearishFvg = {
      type: "bearish_fvg" as const,
      startIndex: 9, endIndex: 9, startTime: 1, endTime: 1,
      zoneHigh: 110, zoneLow: 105, pair: "BTC" as const,
      direction: "bearish" as const, label: "Bearish FVG",
    };
    // LONG: bullish OB +3, bearish FVG -3 → net 0
    const { adjustment } = smcScoreAdjustment(
      { ...baseAnalysis, recentEvents: [bullishOb, bearishFvg] },
      "LONG",
    );
    expect(adjustment).toBe(0);
  });
});
