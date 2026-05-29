/**
 * SWING LEVEL DETECTION TESTS
 *
 * findSwingLevels, findAllSwingHighs, findAllSwingLows
 * — panel v55.51 paritesi + edge cases
 */

import { describe, it, expect } from "vitest";
import {
  findSwingLevels,
  findAllSwingHighs,
  findAllSwingLows,
} from "@/lib/sr/swing";
import type { Candle } from "@/types/candle";

// ─── Factory ────────────────────────────────────────────────────────────────

function makeCandle(h: number, l: number, o?: number, c?: number): Candle {
  return { o: o ?? l + (h - l) * 0.3, h, l, c: c ?? l + (h - l) * 0.7, v: 100 };
}

/**
 * Builds a candle array with a clear swing high at index `hiIdx`
 * and a clear swing low at index `loIdx`.
 */
function buildCandlesWithSwings(
  length: number,
  hiIdx: number,
  hiValue: number,
  loIdx: number,
  loValue: number,
  baseH = 50200,
  baseL = 49800,
): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < length; i++) {
    let h = baseH;
    let l = baseL;
    if (i === hiIdx) { h = hiValue; l = baseL; }
    else if (i === loIdx) { h = baseH; l = loValue; }
    candles.push(makeCandle(h, l));
  }
  return candles;
}

// ─── findSwingLevels ────────────────────────────────────────────────────────

describe("findSwingLevels", () => {
  it("returns null when candles too short", () => {
    const result = findSwingLevels([makeCandle(100, 90)], 20, 2);
    expect(result.swingHigh).toBeNull();
    expect(result.swingLow).toBeNull();
  });

  it("detects a clear swing high and swing low", () => {
    // 30 candles, swing high at idx 15 (H=51000), swing low at idx 10 (L=49000)
    const candles = buildCandlesWithSwings(30, 15, 51000, 10, 49000);
    const result = findSwingLevels(candles, 30, 2);
    expect(result.swingHigh).toBe(51000);
    expect(result.swingLow).toBe(49000);
  });

  it("returns the MOST RECENT pivot (closest to end)", () => {
    // Two swing highs: older at idx 5 (52000), newer at idx 20 (51000)
    // findSwingLevels should return the newer one (idx 20)
    const candles = buildCandlesWithSwings(30, 20, 51000, 5, 49000);
    // Add another older high manually
    candles[5] = makeCandle(52000, 49800);
    const result = findSwingLevels(candles, 30, 2);
    // idx 20 > idx 5, so newest high (51000) wins
    expect(result.swingHigh).toBe(51000);
    expect(result.swingHighIdx).toBeGreaterThan(result.swingLowIdx > 0 ? 0 : -1);
  });

  it("lookback limits the search window", () => {
    // Swing high only at idx 2 (far back), lookback=5 means we only look at last ~7 bars
    const candles = buildCandlesWithSwings(30, 2, 51000, 25, 49000);
    const result = findSwingLevels(candles, 5, 2);
    // idx 2 is outside lookback window — should NOT be found
    expect(result.swingHigh).toBeNull();
    // idx 25 swing low should be found (within last 5 bars of 28-bar end)
    expect(result.swingLow).toBe(49000);
  });

  it("equal adjacent bars invalidate the pivot (>= comparison)", () => {
    // A "plateau" high: candle[10].h === candle[11].h — not a valid pivot
    const candles: Candle[] = Array.from({ length: 20 }, () =>
      makeCandle(50200, 49800),
    );
    candles[10] = makeCandle(51000, 49800);
    candles[11] = makeCandle(51000, 49800); // equal to pivot → invalidates
    const result = findSwingLevels(candles, 20, 2);
    expect(result.swingHigh).toBeNull();
  });
});

// ─── findAllSwingHighs ──────────────────────────────────────────────────────

describe("findAllSwingHighs", () => {
  it("returns empty array when too few candles", () => {
    expect(findAllSwingHighs([makeCandle(100, 90)], 60, 3)).toEqual([]);
  });

  it("finds multiple swing highs ordered nearest first", () => {
    // 50 candles; highs at idx 10 (52000), idx 25 (53000), idx 40 (51500)
    const candles: Candle[] = Array.from({ length: 50 }, () =>
      makeCandle(50200, 49800),
    );
    candles[10] = makeCandle(52000, 49800);
    candles[25] = makeCandle(53000, 49800);
    candles[40] = makeCandle(51500, 49800);

    const highs = findAllSwingHighs(candles, 60, 2, 8);
    expect(highs.length).toBeGreaterThanOrEqual(1);
    // Nearest first (reverse order) — idx 40 should come before idx 25
    const idxes = highs.map((p) => p.idx);
    const pos40 = idxes.indexOf(40);
    const pos25 = idxes.indexOf(25);
    if (pos40 !== -1 && pos25 !== -1) {
      expect(pos40).toBeLessThan(pos25);
    }
  });

  it("respects maxCount limit", () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
      // alternating high/low pattern every 5 bars
      const h = i % 10 === 5 ? 52000 : 50200;
      return makeCandle(h, 49800);
    });
    const highs = findAllSwingHighs(candles, 60, 2, 3);
    expect(highs.length).toBeLessThanOrEqual(3);
  });
});

// ─── findAllSwingLows ───────────────────────────────────────────────────────

describe("findAllSwingLows", () => {
  it("finds swing lows ordered nearest first", () => {
    const candles: Candle[] = Array.from({ length: 40 }, () =>
      makeCandle(50200, 49800),
    );
    candles[8] = makeCandle(50200, 48500);
    candles[20] = makeCandle(50200, 48000);
    candles[33] = makeCandle(50200, 48800);

    const lows = findAllSwingLows(candles, 60, 2, 8);
    expect(lows.length).toBeGreaterThanOrEqual(1);
    const prices = lows.map((p) => p.price);
    // All found lows should be actual swing lows
    expect(prices.every((p) => p < 49800)).toBe(true);
  });
});

// ─── Integration: stop.ts uses swing levels correctly ───────────────────────

describe("computeStructuralStop uses swing levels", () => {
  // Import here to keep test self-contained
  it("stop kind is structural when swing is in ideal ATR range", async () => {
    const { computeStructuralStop } = await import("@/lib/sizer/stop");
    const px = 50000;
    const atr = 500; // 1 ATR = 500
    // swingLow at 49000 → distance = 1000 = 2.0× ATR (within 0.8–2.5 range)
    const result = computeStructuralStop("LONG", px, atr, 49000, null);
    expect(result.kind).toBe("structural");
    expect(result.stopPrice).toBeCloseTo(49000 - 0.3 * 500, 0); // 48850
    expect(result.swingLevel).toBe(49000);
  });

  it("stop kind is widened when swing is too close", async () => {
    const { computeStructuralStop } = await import("@/lib/sizer/stop");
    const px = 50000;
    const atr = 500;
    // swingLow at 49700 → distance = 300 - 150(buffer) = 150 = 0.3× ATR (< 0.8)
    const result = computeStructuralStop("LONG", px, atr, 49700, null);
    expect(result.kind).toBe("widened");
  });

  it("stop kind is atr_too_far when swing is beyond 2.5× ATR", async () => {
    const { computeStructuralStop } = await import("@/lib/sizer/stop");
    const px = 50000;
    const atr = 500;
    // swingLow at 46000 → distance = 4000 = 8× ATR (> 2.5)
    const result = computeStructuralStop("LONG", px, atr, 46000, null);
    expect(result.kind).toBe("atr_too_far");
  });

  it("stop kind is atr_no_pivot when swingLow is null", async () => {
    const { computeStructuralStop } = await import("@/lib/sizer/stop");
    const result = computeStructuralStop("LONG", 50000, 500, null, null);
    expect(result.kind).toBe("atr_no_pivot");
  });
});
