/**
 * INDICATOR UNIT TESTS
 *
 * ATR, EMA, RSI, ADX, VWAP, BB, CVD — score engine ve sizer'ın kalbi.
 * Her fonksiyon için: temel doğruluk, edge case, null güvenliği.
 */

import { describe, it, expect } from "vitest";
import { atr } from "@/lib/indicators/atr";
import { ema, emaSeries } from "@/lib/indicators/ema";
import { rsi, rsiSeries } from "@/lib/indicators/rsi";
import { adx } from "@/lib/indicators/adx";
import { vwap } from "@/lib/indicators/vwap";
import { bb } from "@/lib/indicators/bb";
import {
  computeCvdWindow,
  computeCvdMultiFrame,
  classifyMagnitude,
  classifyDirection,
  formatCvd,
} from "@/lib/orderflow/cvd";
import type { Candle } from "@/types/candle";
import type { Trade } from "@/lib/orderflow/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** N adet sabit OHLCV mum üret */
function makeCandles(count: number, price = 50000, opts: Partial<Candle> = {}): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    o: price,
    h: price + 100,
    l: price - 100,
    c: price,
    v: 100,
    t: Date.now() - (count - i) * 3_600_000, // saatlik
    ...opts,
  }));
}

/** Yükselen fiyat serisi — her bar +1 */
function risingCandles(count: number, start = 1000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    o: start + i,
    h: start + i + 0.5,
    l: start + i - 0.5,
    c: start + i,
    v: 100,
    t: Date.now() - (count - i) * 3_600_000,
  }));
}

/** Düşen fiyat serisi */
function fallingCandles(count: number, start = 2000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    o: start - i,
    h: start - i + 0.5,
    l: start - i - 0.5,
    c: start - i,
    v: 100,
    t: Date.now() - (count - i) * 3_600_000,
  }));
}

function makeTrade(
  side: "buy" | "sell",
  notionalUsd: number,
  msAgo: number,
  now: number,
): Trade {
  return {
    tradeId: `t-${Math.random()}`,
    pair: "BTC",
    timestamp: now - msAgo,
    price: 50000,
    size: notionalUsd / 50000,
    notionalUsd,
    side,
  };
}

// ─────────────────────────────────────────────────────────────
// ATR
// ─────────────────────────────────────────────────────────────

describe("atr()", () => {
  it("null when insufficient candles", () => {
    expect(atr(makeCandles(5), { period: 14 })).toBeNull();
  });

  it("returns positive value for normal data", () => {
    const result = atr(makeCandles(30), { period: 14 });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it("high volatility → larger ATR than low volatility", () => {
    const highVol = Array.from({ length: 30 }, (_, i) => ({
      o: 50000,
      h: 51000, // 1000 range
      l: 49000,
      c: 50000,
      v: 100,
      t: i * 3_600_000,
    }));
    const lowVol = Array.from({ length: 30 }, (_, i) => ({
      o: 50000,
      h: 50010, // 20 range
      l: 49990,
      c: 50000,
      v: 100,
      t: i * 3_600_000,
    }));
    const atrHigh = atr(highVol, { period: 14 })!;
    const atrLow = atr(lowVol, { period: 14 })!;
    expect(atrHigh).toBeGreaterThan(atrLow);
  });

  it("default period 14 works", () => {
    expect(atr(makeCandles(30))).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// EMA
// ─────────────────────────────────────────────────────────────

describe("ema()", () => {
  it("null when too few closes", () => {
    expect(ema([1, 2, 3], { period: 20 })).toBeNull();
  });

  it("seed = simple average of first n bars", () => {
    // First 3 closes: 10, 20, 30 → seed = 20
    // 4th close: 40 → ema = 40*(2/4) + 20*(2/4) = 20+10 = 30
    const closes = [10, 20, 30, 40];
    const result = ema(closes, { period: 3 });
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(30, 4);
  });

  it("rising series → EMA trails close (lagging)", () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    const result = ema(closes, { period: 10 });
    // EMA should be below latest close for rising series
    expect(result!).toBeLessThan(closes[closes.length - 1]);
  });

  it("throws on period <= 0", () => {
    expect(() => ema([1, 2, 3], { period: 0 })).toThrow();
  });
});

describe("emaSeries()", () => {
  it("first (n-1) elements are null", () => {
    const series = emaSeries([1, 2, 3, 4, 5], { period: 3 });
    expect(series[0]).toBeNull();
    expect(series[1]).toBeNull();
    expect(series[2]).not.toBeNull(); // n-1 = 2 (0-indexed)
  });

  it("length matches input", () => {
    const series = emaSeries([10, 20, 30, 40, 50], { period: 3 });
    expect(series).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────
// RSI
// ─────────────────────────────────────────────────────────────

describe("rsi()", () => {
  it("null for insufficient data", () => {
    expect(rsi([1, 2, 3], { period: 14 })).toBeNull();
  });

  it("pure rising → RSI near 100", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const result = rsi(closes, { period: 14 });
    expect(result!).toBeGreaterThan(90);
  });

  it("pure falling → RSI near 0", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 1000 - i);
    const result = rsi(closes, { period: 14 });
    expect(result!).toBeLessThan(10);
  });

  it("flat price → RSI = 100 (no losses, avgLoss=0 guard)", () => {
    // RSI spec: when avgLoss=0, return 100 (no downside moves)
    const closes = Array.from({ length: 30 }, () => 100);
    const result = rsi(closes, { period: 14 });
    expect(result).toBe(100);
  });

  it("RSI bounded 0-100", () => {
    const closes = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0 ? 1000 : 1, // extreme oscillation
    );
    const result = rsi(closes, { period: 14 });
    if (result !== null) {
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it("throws on period <= 0", () => {
    expect(() => rsi([1, 2, 3], { period: 0 })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// ADX
// ─────────────────────────────────────────────────────────────

describe("adx()", () => {
  it("null when too few candles (< 2*period+1)", () => {
    expect(adx(makeCandles(20), 14)).toBeNull();
  });

  it("returns adx, plusDI, minusDI for sufficient data", () => {
    const result = adx(makeCandles(35), 14);
    expect(result).not.toBeNull();
    expect(result!.adx).toBeGreaterThanOrEqual(0);
    expect(result!.plusDI).toBeGreaterThanOrEqual(0);
    expect(result!.minusDI).toBeGreaterThanOrEqual(0);
  });

  it("strong uptrend → plusDI > minusDI", () => {
    const result = adx(risingCandles(50), 14);
    expect(result).not.toBeNull();
    expect(result!.plusDI).toBeGreaterThan(result!.minusDI);
  });

  it("strong downtrend → minusDI > plusDI", () => {
    const result = adx(fallingCandles(50), 14);
    expect(result).not.toBeNull();
    expect(result!.minusDI).toBeGreaterThan(result!.plusDI);
  });
});

// ─────────────────────────────────────────────────────────────
// VWAP
// ─────────────────────────────────────────────────────────────

describe("vwap()", () => {
  it("null for < 3 candles", () => {
    const candles = makeCandles(2);
    expect(vwap(candles, new Date())).toBeNull();
  });

  it("vwap is between low and high of the session", () => {
    // All bars: h=50100, l=49900, c=50000
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      o: 50000,
      h: 50100,
      l: 49900,
      c: 50000,
      v: 100,
      t: todayStart + i * 3_600_000,
    }));
    const result = vwap(candles, now);
    expect(result).not.toBeNull();
    expect(result!.vwap).toBeGreaterThan(49900);
    expect(result!.vwap).toBeLessThan(50100);
  });

  it("stddev = 0 when all prices identical", () => {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      o: 100,
      h: 100,
      l: 100,
      c: 100,
      v: 100,
      t: todayStart + i * 3_600_000,
    }));
    const result = vwap(candles, now);
    expect(result!.stddev).toBe(0);
    expect(result!.upperBand).toBe(result!.vwap);
    expect(result!.lowerBand).toBe(result!.vwap);
  });
});

// ─────────────────────────────────────────────────────────────
// BB (Bollinger Bands)
// ─────────────────────────────────────────────────────────────

describe("bb()", () => {
  it("null for insufficient data", () => {
    expect(bb([1, 2, 3], { period: 20 })).toBeNull();
  });

  it("upper > mean > lower", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5);
    const result = bb(closes, { period: 20 });
    expect(result).not.toBeNull();
    expect(result!.upper).toBeGreaterThan(result!.mean);
    expect(result!.mean).toBeGreaterThan(result!.lower);
  });

  it("flat price → sd = 0, upper = lower = mean", () => {
    const closes = Array.from({ length: 25 }, () => 1000);
    const result = bb(closes, { period: 20 });
    expect(result!.sd).toBeCloseTo(0, 5);
    expect(result!.upper).toBeCloseTo(result!.lower, 5);
    expect(result!.mean).toBeCloseTo(1000, 5);
  });

  it("pct is in [0,1] range for oscillating data", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 10);
    const result = bb(closes, { period: 20 });
    expect(result!.pct).toBeGreaterThanOrEqual(0);
    expect(result!.pct).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────
// CVD
// ─────────────────────────────────────────────────────────────

describe("CVD — computeCvdWindow()", () => {
  const now = Date.now();

  it("empty trades → cvd = 0, direction = neutral", () => {
    const result = computeCvdWindow("BTC", [], 5 * 60_000, now);
    expect(result.cvdUsd).toBe(0);
    expect(result.direction).toBe("neutral");
    expect(result.tradeCount).toBe(0);
  });

  it("pure buy pressure → bullish direction", () => {
    const trades: Trade[] = [
      makeTrade("buy", 200_000, 60_000, now),  // 200K buy, 1 min ago
      makeTrade("buy", 200_000, 120_000, now), // 200K buy, 2 min ago
    ];
    const result = computeCvdWindow("BTC", trades, 5 * 60_000, now);
    expect(result.cvdUsd).toBeCloseTo(400_000);
    expect(result.direction).toBe("bullish");
    expect(result.magnitude).toBe("weak"); // 400K > 100K threshold
  });

  it("pure sell pressure → bearish direction", () => {
    const trades: Trade[] = [
      makeTrade("sell", 600_000, 60_000, now),
    ];
    const result = computeCvdWindow("BTC", trades, 5 * 60_000, now);
    expect(result.cvdUsd).toBeCloseTo(-600_000);
    expect(result.direction).toBe("bearish");
    expect(result.magnitude).toBe("strong");
  });

  it("old trades outside window are excluded", () => {
    const trades: Trade[] = [
      makeTrade("buy", 1_000_000, 10 * 60_000, now), // 10 min ago — outside 5min window
      makeTrade("sell", 500_000, 60_000, now),        // 1 min ago — inside
    ];
    const result = computeCvdWindow("BTC", trades, 5 * 60_000, now);
    // Only the sell trade counts
    expect(result.cvdUsd).toBeCloseTo(-500_000);
    expect(result.tradeCount).toBe(1);
  });

  it("balanced buy/sell → neutral direction (below threshold)", () => {
    const trades: Trade[] = [
      makeTrade("buy", 50_000, 60_000, now),   // below weak threshold
      makeTrade("sell", 50_000, 120_000, now),
    ];
    const result = computeCvdWindow("BTC", trades, 5 * 60_000, now);
    expect(result.cvdUsd).toBeCloseTo(0);
    expect(result.direction).toBe("neutral");
  });
});

describe("CVD — computeCvdMultiFrame()", () => {
  const now = Date.now();

  it("full buy pressure across all frames → 3-way confluence bullish", () => {
    const trades: Trade[] = [
      makeTrade("buy", 300_000, 30_000, now),   // 30s ago (in all windows)
      makeTrade("buy", 300_000, 60_000, now),
      makeTrade("buy", 300_000, 200_000, now),  // 3.3min ago
      makeTrade("buy", 300_000, 600_000, now),  // 10min ago (in 15m only)
    ];
    const result = computeCvdMultiFrame("BTC", trades, now);
    expect(result.confluenceDirection).toBe("bullish");
    expect(result.confluence).toBeGreaterThanOrEqual(2);
  });

  it("all frames empty → confluence = 0", () => {
    const result = computeCvdMultiFrame("BTC", [], now);
    expect(result.confluence).toBe(0);
    expect(result.confluenceDirection).toBe("neutral");
  });
});

describe("CVD — classifyMagnitude()", () => {
  it("BTC: < 100K → neutral", () => {
    expect(classifyMagnitude("BTC", 50_000)).toBe("neutral");
  });
  it("BTC: 200K → weak", () => {
    expect(classifyMagnitude("BTC", 200_000)).toBe("weak");
  });
  it("BTC: 1M → strong", () => {
    expect(classifyMagnitude("BTC", 1_000_000)).toBe("strong");
  });
  it("BTC: 3M → extreme", () => {
    expect(classifyMagnitude("BTC", 3_000_000)).toBe("extreme");
  });
  it("ETH: thresholds 0.25x of BTC", () => {
    // ETH weak threshold = 100K * 0.25 = 25K
    expect(classifyMagnitude("ETH", 20_000)).toBe("neutral");
    expect(classifyMagnitude("ETH", 30_000)).toBe("weak");
  });
});

describe("CVD — formatCvd()", () => {
  it("+500K → +$500K", () => {
    expect(formatCvd(500_000)).toBe("+$500K");
  });
  it("-1.5M → -$1.5M", () => {
    expect(formatCvd(-1_500_000)).toBe("-$1.5M");
  });
  it("+300 → +$300", () => {
    expect(formatCvd(300)).toBe("+$300");
  });
  it("zero → +$0", () => {
    expect(formatCvd(0)).toBe("+$0");
  });
});
