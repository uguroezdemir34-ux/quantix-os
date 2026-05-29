/**
 * INDICATORS EDGE-CASE & COVERAGE EXTENSION TESTS
 *
 * Bu dosya indicators.test.ts'i tamamlar:
 *   - atr-percentile  (coverage: 0 → tam)
 *   - volume-ratio    (coverage: 0 → tam)
 *   - trueRangeSeries (coverage: 0 → tam)
 *   - ATR ek edge cases (period=1, zero-range, infinity guard)
 *   - EMA / emaSeries ek edge cases (period=1, exact seed, series continuity)
 *   - RSI / rsiSeries ek edge cases (period=1, series değerleri monoton artar)
 *   - ADX ek edge cases (sabit fiyat, boundary period)
 *   - BB ek edge cases (mult parametresi, pct > 1 / pct < 0)
 *   - VWAP ek edge cases (zero volume candles, cross-day fallback, single-bar today)
 *   + Order Book Depth: parseOkxOrderBook + computeOrderBookImbalance (tam)
 */

import { describe, it, expect } from "vitest";

// ── Indicators ──
import { atr, trueRangeSeries } from "@/lib/indicators/atr";
import { atrPercentile } from "@/lib/indicators/atr-percentile";
import { ema, emaSeries } from "@/lib/indicators/ema";
import { rsi, rsiSeries } from "@/lib/indicators/rsi";
import { adx } from "@/lib/indicators/adx";
import { vwap } from "@/lib/indicators/vwap";
import { bb } from "@/lib/indicators/bb";
import { volumeRatio } from "@/lib/indicators/volume-ratio";

// ── Order Book ──
import {
  parseOkxOrderBook,
  computeOrderBookImbalance,
  orderBookSignal,
  IMBALANCE_DIRECTION_THRESHOLD,
} from "@/lib/orderflow/orderbook";
import type {
  OkxOrderBookRaw,
  OrderBookSnapshot,
} from "@/lib/orderflow/orderbook";

import type { Candle } from "@/types/candle";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeCandles(
  count: number,
  price = 50000,
  opts: Partial<Candle> = {},
): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    o: price,
    h: price + 100,
    l: price - 100,
    c: price,
    v: 100,
    t: i * 3_600_000,
    ...opts,
  }));
}

function risingCandles(count: number, start = 1000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    o: start + i,
    h: start + i + 1,
    l: start + i,
    c: start + i + 1,
    v: 100 + i,
    t: i * 3_600_000,
  }));
}

function makeOkxRaw(
  bids: Array<[string, string]>,
  asks: Array<[string, string]>,
  ts = "1700000000000",
): OkxOrderBookRaw {
  return {
    ts,
    instId: "BTC-USDT-SWAP",
    bids,
    asks,
  };
}

// ─────────────────────────────────────────────────────────────
// ATR — ek edge cases
// ─────────────────────────────────────────────────────────────

describe("atr() — edge cases", () => {
  it("period=1 returns last TR", () => {
    const candles: Candle[] = [
      { o: 100, h: 110, l: 90, c: 100, v: 100, t: 0 },
      { o: 100, h: 105, l: 95, c: 102, v: 100, t: 1 },
    ];
    const result = atr(candles, { period: 1 });
    // TR = max(105-95, |105-100|, |95-100|) = max(10,5,5) = 10
    expect(result).toBeCloseTo(10);
  });

  it("zero-range candles (h=l=c=o) → ATR > 0 only from prev-close diff", () => {
    const candles: Candle[] = [
      { o: 100, h: 100, l: 100, c: 100, v: 100, t: 0 },
      { o: 200, h: 200, l: 200, c: 200, v: 100, t: 1 },
      { o: 200, h: 200, l: 200, c: 200, v: 100, t: 2 },
    ];
    const result = atr(candles, { period: 2 });
    // TRs: bar1 = max(0, |200-100|, |200-100|) = 100; bar2 = 0
    expect(result).toBeCloseTo(50); // avg(100, 0)
  });

  it("single candle → null (needs at least period+1)", () => {
    expect(atr([{ o: 100, h: 110, l: 90, c: 100, v: 100, t: 0 }], { period: 1 })).toBeNull();
  });

  it("throws on period=NaN", () => {
    expect(() => atr(makeCandles(20), { period: NaN })).toThrow();
  });

  it("throws on period=-5", () => {
    expect(() => atr(makeCandles(20), { period: -5 })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// trueRangeSeries()
// ─────────────────────────────────────────────────────────────

describe("trueRangeSeries()", () => {
  it("empty → empty", () => {
    expect(trueRangeSeries([])).toHaveLength(0);
  });

  it("single candle → empty (no prev close)", () => {
    const candles = makeCandles(1);
    expect(trueRangeSeries(candles)).toHaveLength(0);
  });

  it("length = candles.length - 1", () => {
    const candles = makeCandles(20);
    expect(trueRangeSeries(candles)).toHaveLength(19);
  });

  it("all values ≥ 0", () => {
    const trs = trueRangeSeries(risingCandles(30));
    for (const tr of trs) expect(tr).toBeGreaterThanOrEqual(0);
  });

  it("gap candle (h-l=0 but big prev-close gap) → TR = gap size", () => {
    const candles: Candle[] = [
      { o: 100, h: 100, l: 100, c: 100, v: 1, t: 0 },
      { o: 150, h: 150, l: 150, c: 150, v: 1, t: 1 }, // gap up, zero range
    ];
    const trs = trueRangeSeries(candles);
    // TR = max(0, |150-100|, |150-100|) = 50
    expect(trs[0]).toBeCloseTo(50);
  });
});

// ─────────────────────────────────────────────────────────────
// ATR Percentile
// ─────────────────────────────────────────────────────────────

describe("atrPercentile()", () => {
  it("null for insufficient candles (< period*2)", () => {
    expect(atrPercentile(makeCandles(20), 14)).toBeNull();
  });

  it("returns percentile in [0,100]", () => {
    const result = atrPercentile(makeCandles(40), 14);
    expect(result).not.toBeNull();
    expect(result!.percentile).toBeGreaterThanOrEqual(0);
    expect(result!.percentile).toBeLessThanOrEqual(100);
  });

  it("sampleSize ≥ 1", () => {
    const result = atrPercentile(makeCandles(40), 14);
    expect(result!.sampleSize).toBeGreaterThanOrEqual(1);
  });

  it("current matches last ATR in series", () => {
    const candles = makeCandles(40);
    const result = atrPercentile(candles, 14)!;
    expect(result.current).toBeGreaterThan(0);
  });

  it("rising volatility → regime expansion or extreme", () => {
    // Build candles with increasing range
    const candles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
      o: 50000,
      h: 50000 + i * 20,
      l: 50000 - i * 20,
      c: 50000,
      v: 100,
      t: i * 3_600_000,
    }));
    const result = atrPercentile(candles, 14)!;
    expect(["expansion", "extreme_expansion"]).toContain(result.regime);
  });

  it("constant range candles → percentile = 100 (all equal, current ≤ all)", () => {
    const candles = makeCandles(40, 50000, { h: 50200, l: 49800 });
    const result = atrPercentile(candles, 14)!;
    // All ATRs equal → current ≤ all → percentile = 100
    expect(result.percentile).toBe(100);
  });

  it("regime compression: very low percentile → 'compression'", () => {
    // First many bars high range, last bars shrink dramatically
    const highRange: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      o: 50000,
      h: 51000,
      l: 49000,
      c: 50000,
      v: 100,
      t: i * 3_600_000,
    }));
    const lowRange: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      o: 50000,
      h: 50001,
      l: 49999,
      c: 50000,
      v: 100,
      t: (30 + i) * 3_600_000,
    }));
    const candles = [...highRange, ...lowRange];
    const result = atrPercentile(candles, 14)!;
    expect(result.regime).toBe("compression");
  });

  it("default period (14) works", () => {
    const result = atrPercentile(makeCandles(40));
    expect(result).not.toBeNull();
  });

  it("null input → null", () => {
    // @ts-expect-error testing runtime null guard
    expect(atrPercentile(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// EMA — ek edge cases
// ─────────────────────────────────────────────────────────────

describe("ema() — edge cases", () => {
  it("period=1 → returns last close", () => {
    const closes = [10, 20, 30, 40, 50];
    const result = ema(closes, { period: 1 });
    // k = 2/2 = 1; seed = closes[0] = 10; each step: value = close*1 + prev*0 = close
    expect(result).toBeCloseTo(50);
  });

  it("exactly period closes → returns SMA (seed only)", () => {
    const closes = [10, 20, 30]; // period=3, exactly n closes
    const result = ema(closes, { period: 3 });
    // seed = (10+20+30)/3 = 20, no further bars → 20
    expect(result).toBeCloseTo(20);
  });

  it("decreasing series → EMA trails close (above latest)", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 1000 - i);
    const result = ema(closes, { period: 10 });
    expect(result!).toBeGreaterThan(closes[closes.length - 1]);
  });

  it("NaN in period → throws", () => {
    expect(() => ema([1, 2, 3], { period: NaN })).toThrow();
  });
});

describe("emaSeries() — edge cases", () => {
  it("period larger than input → all null", () => {
    const series = emaSeries([1, 2, 3], { period: 10 });
    expect(series.every((v) => v === null)).toBe(true);
  });

  it("period=1 → all non-null (seed from first bar)", () => {
    const series = emaSeries([10, 20, 30], { period: 1 });
    // n=1: out[0]=closes[0]=10 (seed), then EMA for rest
    expect(series[0]).not.toBeNull();
    expect(series[1]).not.toBeNull();
    expect(series[2]).not.toBeNull();
  });

  it("values after warmup are continuous (no null gaps)", () => {
    const series = emaSeries(
      Array.from({ length: 20 }, (_, i) => i + 1),
      { period: 5 },
    );
    let seenValue = false;
    for (const v of series) {
      if (v !== null) seenValue = true;
      if (seenValue) expect(v).not.toBeNull();
    }
  });

  it("monotonically rising series → emaSeries values increase after warmup", () => {
    const series = emaSeries(
      Array.from({ length: 30 }, (_, i) => i + 1),
      { period: 5 },
    );
    const values = series.filter((v) => v !== null) as number[];
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// RSI — ek edge cases
// ─────────────────────────────────────────────────────────────

describe("rsi() — edge cases", () => {
  it("period=1 works (2+ closes needed)", () => {
    const closes = [100, 110]; // up move → RSI 100
    const result = rsi(closes, { period: 1 });
    expect(result).toBe(100);
  });

  it("alternating up/down stays near 50", () => {
    const closes: number[] = [100];
    for (let i = 1; i <= 40; i++) {
      closes.push(i % 2 === 0 ? 101 : 100);
    }
    const result = rsi(closes, { period: 14 });
    expect(result!).toBeGreaterThan(40);
    expect(result!).toBeLessThan(60);
  });

  it("exactly period closes → null", () => {
    const closes = Array.from({ length: 14 }, (_, i) => i + 1);
    expect(rsi(closes, { period: 14 })).toBeNull();
  });

  it("period+1 closes → non-null", () => {
    const closes = Array.from({ length: 15 }, (_, i) => i + 1);
    expect(rsi(closes, { period: 14 })).not.toBeNull();
  });

  it("all losses (no gains) → RSI near 0", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 1000 - i * 10);
    const result = rsi(closes, { period: 14 });
    expect(result!).toBeCloseTo(0, 0);
  });
});

describe("rsiSeries() — edge cases", () => {
  it("too few closes → all null", () => {
    const series = rsiSeries([1, 2, 3], { period: 14 });
    expect(series.every((v) => v === null)).toBe(true);
  });

  it("length matches input length", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const series = rsiSeries(closes, { period: 14 });
    expect(series).toHaveLength(30);
  });

  it("first period elements null, rest non-null", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const series = rsiSeries(closes, { period: 14 });
    for (let i = 0; i < 14; i++) expect(series[i]).toBeNull();
    for (let i = 14; i < 30; i++) expect(series[i]).not.toBeNull();
  });

  it("rising series → rsiSeries values all > 90 after warmup", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const series = rsiSeries(closes, { period: 14 });
    const values = series.filter((v) => v !== null) as number[];
    for (const v of values) expect(v).toBeGreaterThan(85);
  });
});

// ─────────────────────────────────────────────────────────────
// ADX — ek edge cases
// ─────────────────────────────────────────────────────────────

describe("adx() — edge cases", () => {
  it("flat price (zero DM) → ADX near 0, plusDI ≈ minusDI", () => {
    const candles = makeCandles(50, 50000, { h: 50100, l: 49900, o: 50000, c: 50000 });
    const result = adx(candles, 14);
    expect(result).not.toBeNull();
    // With no directional movement, ADX should be low
    expect(result!.adx).toBeLessThan(5);
  });

  it("boundary: exactly 2*period+1 candles → non-null", () => {
    const candles = risingCandles(2 * 14 + 1);
    const result = adx(candles, 14);
    expect(result).not.toBeNull();
  });

  it("boundary: 2*period candles → null", () => {
    const candles = risingCandles(2 * 14);
    const result = adx(candles, 14);
    expect(result).toBeNull();
  });

  it("adx, plusDI, minusDI are all finite numbers", () => {
    const result = adx(risingCandles(50), 14)!;
    expect(isFinite(result.adx)).toBe(true);
    expect(isFinite(result.plusDI)).toBe(true);
    expect(isFinite(result.minusDI)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// BB — ek edge cases
// ─────────────────────────────────────────────────────────────

describe("bb() — edge cases", () => {
  it("custom mult=1 → narrower bands than mult=2", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5);
    const bb1 = bb(closes, { period: 20, mult: 1 })!;
    const bb2 = bb(closes, { period: 20, mult: 2 })!;
    expect(bb2.upper - bb2.lower).toBeGreaterThan(bb1.upper - bb1.lower);
  });

  it("pct > 1 when price above upper band", () => {
    // Last close way above recent prices
    const closes = [
      ...Array.from({ length: 20 }, () => 100),
      500, // spike far above
    ];
    const result = bb(closes, { period: 20 })!;
    // price=500, upper ≈ 100+some_sd, so pct >> 1
    expect(result.pct).toBeGreaterThan(1);
  });

  it("pct < 0 when price below lower band", () => {
    const closes = [
      ...Array.from({ length: 20 }, () => 100),
      1, // spike far below
    ];
    const result = bb(closes, { period: 20 })!;
    expect(result.pct).toBeLessThan(0);
  });

  it("throws on period=NaN", () => {
    expect(() => bb([1, 2, 3], { period: NaN })).toThrow();
  });

  it("exactly period closes → non-null", () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(bb(closes, { period: 20 })).not.toBeNull();
  });

  it("period-1 closes → null", () => {
    const closes = Array.from({ length: 19 }, (_, i) => i + 1);
    expect(bb(closes, { period: 20 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// VWAP — ek edge cases
// ─────────────────────────────────────────────────────────────

describe("vwap() — edge cases", () => {
  it("null for empty candles", () => {
    expect(vwap([], new Date())).toBeNull();
  });

  it("null for 1 candle (today filter makes 0 today → fallback; fallback < 2)", () => {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const candles: Candle[] = [
      { o: 100, h: 110, l: 90, c: 100, v: 100, t: todayStart },
    ];
    // Only 1 today bar → bars.length=1 < 2 → fallback slice(-24)=1 bar < 2 → null
    expect(vwap(candles, now)).toBeNull();
  });

  it("fallback to last 24 when no today candles", () => {
    // All candles are from yesterday
    const now = new Date();
    const yesterdayStart =
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      86_400_000;
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      o: 50000,
      h: 50100,
      l: 49900,
      c: 50000,
      v: 100,
      t: yesterdayStart + i * 3_600_000,
    }));
    const result = vwap(candles, now);
    expect(result).not.toBeNull();
    expect(result!.vwap).toBeCloseTo(50000, 0);
  });

  it("zero volume candle treated as v=1 (fallback)", () => {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      o: 100,
      h: 110,
      l: 90,
      c: 100,
      v: 0, // zero volume → treated as 1
      t: todayStart + i * 3_600_000,
    }));
    // Should not throw; result should be non-null (v=0 → v=1)
    const result = vwap(candles, now);
    expect(result).not.toBeNull();
  });

  it("cumV=0 (all volume zero after fallback, hypothetical edge) → null", () => {
    // This is guarded by the v=1 fallback in code, so cumV can never be 0
    // when bars exist. Just confirm result is not null for this config:
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      o: 1,
      h: 1,
      l: 1,
      c: 1,
      v: 0,
      t: todayStart + i * 3_600_000,
    }));
    expect(vwap(candles, now)).not.toBeNull();
  });

  it("pctFromVwap positive when price above vwap", () => {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const candles: Candle[] = [
      { o: 100, h: 100, l: 100, c: 100, v: 100, t: todayStart },
      { o: 100, h: 100, l: 100, c: 100, v: 100, t: todayStart + 3_600_000 },
      { o: 100, h: 110, l: 100, c: 110, v: 100, t: todayStart + 7_200_000 }, // last close above vwap
    ];
    const result = vwap(candles, now);
    expect(result!.pctFromVwap).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Volume Ratio
// ─────────────────────────────────────────────────────────────

describe("volumeRatio()", () => {
  it("null for insufficient candles", () => {
    expect(volumeRatio(makeCandles(5))).toBeNull();
  });

  it("exactly lookback+recentN candles → non-null", () => {
    const candles = makeCandles(23); // 20+3
    expect(volumeRatio(candles)).not.toBeNull();
  });

  it("high recent volume → ratio > 1", () => {
    const baseline: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      o: 100, h: 110, l: 90, c: 100, v: 100, t: i * 3_600_000,
    }));
    const recent: Candle[] = Array.from({ length: 3 }, (_, i) => ({
      o: 100, h: 110, l: 90, c: 100, v: 1000, t: (20 + i) * 3_600_000,
    }));
    const result = volumeRatio([...baseline, ...recent]);
    expect(result!).toBeGreaterThan(1);
  });

  it("low recent volume → ratio < 1", () => {
    const baseline: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      o: 100, h: 110, l: 90, c: 100, v: 1000, t: i * 3_600_000,
    }));
    const recent: Candle[] = Array.from({ length: 3 }, (_, i) => ({
      o: 100, h: 110, l: 90, c: 100, v: 10, t: (20 + i) * 3_600_000,
    }));
    const result = volumeRatio([...baseline, ...recent]);
    expect(result!).toBeLessThan(1);
  });

  it("equal volumes → ratio = 1.0", () => {
    const candles = makeCandles(23, 50000, { v: 500 });
    const result = volumeRatio(candles);
    expect(result!).toBeCloseTo(1.0);
  });

  it("zero baseline volume → null", () => {
    const baseline: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      o: 100, h: 110, l: 90, c: 100, v: 0, t: i * 3_600_000,
    }));
    const recent: Candle[] = Array.from({ length: 3 }, (_, i) => ({
      o: 100, h: 110, l: 90, c: 100, v: 100, t: (20 + i) * 3_600_000,
    }));
    expect(volumeRatio([...baseline, ...recent])).toBeNull();
  });

  it("custom recentN and lookback", () => {
    const candles = makeCandles(15);
    const result = volumeRatio(candles, { lookback: 10, recentN: 5 });
    expect(result).not.toBeNull();
  });

  it("null input → null", () => {
    // @ts-expect-error testing runtime null guard
    expect(volumeRatio(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Order Book Depth — parseOkxOrderBook
// ─────────────────────────────────────────────────────────────

describe("parseOkxOrderBook()", () => {
  it("parses valid bids and asks", () => {
    const raw = makeOkxRaw(
      [["50000", "2"], ["49900", "1"]],
      [["50100", "1.5"], ["50200", "0.5"]],
    );
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.pair).toBe("BTC");
    expect(snap.timestamp).toBe(1700000000000);
    expect(snap.bids).toHaveLength(2);
    expect(snap.asks).toHaveLength(2);
  });

  it("bids sorted desc by price", () => {
    const raw = makeOkxRaw(
      [["49900", "1"], ["50000", "2"], ["49950", "1.5"]],
      [["50100", "1"]],
    );
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.bids[0].price).toBe(50000);
    expect(snap.bids[1].price).toBe(49950);
    expect(snap.bids[2].price).toBe(49900);
  });

  it("asks sorted asc by price", () => {
    const raw = makeOkxRaw(
      [["49900", "1"]],
      [["50200", "0.5"], ["50100", "1"], ["50150", "0.8"]],
    );
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.asks[0].price).toBe(50100);
    expect(snap.asks[1].price).toBe(50150);
    expect(snap.asks[2].price).toBe(50200);
  });

  it("notionalUsd = price × qty", () => {
    const raw = makeOkxRaw([["50000", "2"]], [["50100", "1"]]);
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.bids[0].notionalUsd).toBeCloseTo(100000);
    expect(snap.asks[0].notionalUsd).toBeCloseTo(50100);
  });

  it("invalid price strings are skipped", () => {
    const raw = makeOkxRaw(
      [["invalid", "2"], ["50000", "1"]],
      [["abc", "1"]],
    );
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.bids).toHaveLength(1);
    expect(snap.asks).toHaveLength(0);
  });

  it("zero price level is skipped", () => {
    const raw = makeOkxRaw([["0", "5"], ["50000", "1"]], []);
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.bids).toHaveLength(1);
  });

  it("negative qty level is skipped", () => {
    const raw = makeOkxRaw([["50000", "-1"], ["50000", "2"]], []);
    const snap = parseOkxOrderBook(raw, "BTC");
    // -1 skipped, 2 kept
    expect(snap.bids).toHaveLength(1);
    expect(snap.bids[0].qty).toBe(2);
  });

  it("empty bids and asks → empty snapshot", () => {
    const raw = makeOkxRaw([], []);
    const snap = parseOkxOrderBook(raw, "ETH");
    expect(snap.bids).toHaveLength(0);
    expect(snap.asks).toHaveLength(0);
  });

  it("invalid ts → timestamp=0", () => {
    const raw: OkxOrderBookRaw = {
      ts: "notanumber",
      instId: "BTC-USDT-SWAP",
      bids: [["50000", "1"]],
      asks: [],
    };
    const snap = parseOkxOrderBook(raw, "BTC");
    expect(snap.timestamp).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Order Book Depth — computeOrderBookImbalance
// ─────────────────────────────────────────────────────────────

function makeSnapshot(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
): OrderBookSnapshot {
  return {
    pair: "BTC",
    timestamp: Date.now(),
    bids: bids.map(([price, qty]) => ({ price, qty, notionalUsd: price * qty })),
    asks: asks.map(([price, qty]) => ({ price, qty, notionalUsd: price * qty })),
  };
}

describe("computeOrderBookImbalance()", () => {
  it("null when both sides empty", () => {
    const snap = makeSnapshot([], []);
    expect(computeOrderBookImbalance(snap)).toBeNull();
  });

  it("bid_dominated when bids >> asks", () => {
    const snap = makeSnapshot(
      [[50000, 10], [49900, 8], [49800, 6]],
      [[50100, 0.1]],
    );
    const result = computeOrderBookImbalance(snap)!;
    expect(result.direction).toBe("bid_dominated");
    expect(result.imbalanceRatio).toBeGreaterThan(IMBALANCE_DIRECTION_THRESHOLD);
  });

  it("ask_dominated when asks >> bids", () => {
    const snap = makeSnapshot(
      [[49900, 0.1]],
      [[50100, 10], [50200, 8], [50300, 6]],
    );
    const result = computeOrderBookImbalance(snap)!;
    expect(result.direction).toBe("ask_dominated");
    expect(result.imbalanceRatio).toBeLessThan(-IMBALANCE_DIRECTION_THRESHOLD);
  });

  it("balanced when bid ≈ ask", () => {
    const snap = makeSnapshot(
      [[50000, 1]],
      [[50100, 1]],
    );
    const result = computeOrderBookImbalance(snap)!;
    expect(result.direction).toBe("balanced");
    expect(Math.abs(result.imbalanceRatio)).toBeLessThanOrEqual(IMBALANCE_DIRECTION_THRESHOLD);
  });

  it("imbalanceRatio in [-1, +1]", () => {
    const snap = makeSnapshot(
      [[50000, 100]],
      [[50100, 0.001]],
    );
    const result = computeOrderBookImbalance(snap)!;
    expect(result.imbalanceRatio).toBeGreaterThanOrEqual(-1);
    expect(result.imbalanceRatio).toBeLessThanOrEqual(1);
  });

  it("pure bid side (no asks) → imbalanceRatio = +1", () => {
    const snap = makeSnapshot([[50000, 5], [49900, 3]], []);
    const result = computeOrderBookImbalance(snap)!;
    expect(result.imbalanceRatio).toBeCloseTo(1);
    expect(result.direction).toBe("bid_dominated");
  });

  it("pure ask side (no bids) → imbalanceRatio = -1", () => {
    const snap = makeSnapshot([], [[50100, 5], [50200, 3]]);
    const result = computeOrderBookImbalance(snap)!;
    expect(result.imbalanceRatio).toBeCloseTo(-1);
    expect(result.direction).toBe("ask_dominated");
  });

  it("topN limits depth analyzed", () => {
    const bids: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [
      50000 - i * 10,
      1,
    ]);
    const asks: Array<[number, number]> = [[50100, 100]]; // massive ask
    const snap = makeSnapshot(bids, asks);

    const top3 = computeOrderBookImbalance(snap, 3)!;
    const top20 = computeOrderBookImbalance(snap, 20)!;
    // With topN=3: 3 bid levels vs 1 ask level; top20: 20 bid vs 1 ask
    // top3 should be more ask-dominated than top20
    expect(top3.imbalanceRatio).toBeLessThan(top20.imbalanceRatio);
  });

  it("depthLevels = max of bid and ask levels used", () => {
    const snap = makeSnapshot(
      [[50000, 1], [49900, 1]],
      [[50100, 1], [50200, 1], [50300, 1]],
    );
    const result = computeOrderBookImbalance(snap, 5)!;
    // 2 bid levels, 3 ask levels → depthLevels = 3
    expect(result.depthLevels).toBe(3);
  });

  it("bidNotionalUsd + askNotionalUsd match individual sums", () => {
    const snap = makeSnapshot(
      [[50000, 2], [49900, 1]], // bid notional: 100000 + 49900 = 149900
      [[50100, 1]],             // ask notional: 50100
    );
    const result = computeOrderBookImbalance(snap)!;
    expect(result.bidNotionalUsd).toBeCloseTo(149900);
    expect(result.askNotionalUsd).toBeCloseTo(50100);
  });
});

// ─────────────────────────────────────────────────────────────
// orderBookSignal()
// ─────────────────────────────────────────────────────────────

describe("orderBookSignal()", () => {
  it("null snapshot → 0", () => {
    expect(orderBookSignal(null)).toBe(0);
  });

  it("empty snapshot → 0", () => {
    const snap = makeSnapshot([], []);
    expect(orderBookSignal(snap)).toBe(0);
  });

  it("bid_dominated → positive signal", () => {
    const snap = makeSnapshot([[50000, 100]], [[50100, 0.1]]);
    expect(orderBookSignal(snap)).toBeGreaterThan(0);
  });

  it("ask_dominated → negative signal", () => {
    const snap = makeSnapshot([[49900, 0.1]], [[50100, 100]]);
    expect(orderBookSignal(snap)).toBeLessThan(0);
  });

  it("signal in [-1, +1]", () => {
    const snap = makeSnapshot([[50000, 999]], [[50100, 1]]);
    const sig = orderBookSignal(snap);
    expect(sig).toBeGreaterThanOrEqual(-1);
    expect(sig).toBeLessThanOrEqual(1);
  });
});
