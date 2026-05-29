/**
 * MTF TREND TESTS
 *
 * computeTimeframeTrend:
 *   - < 20 mum → flat, ema20=null, deviation=0
 *   - close > ema20 +0.1% → up; < -0.1% → down; ±0.1% → flat
 *   - deviation hesabı: (close - ema20) / ema20, signed
 *
 * computeMtfTrend:
 *   - 3 up → strong_up
 *   - 3 down → strong_down
 *   - 2 up, 0 down → up
 *   - 2 down, 0 up → down
 *   - mixed → mixed
 *   - tüm lastClose null → no_data
 *   - upCount/downCount/flatCount doğru
 *   - pair pass-through
 */

import { describe, it, expect } from "vitest";
import {
  computeTimeframeTrend,
  computeMtfTrend,
} from "@/lib/market/mtfTrend";
import type { Candle } from "@/lib/okx/candles";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function makeCandles(count: number, closePrice = 50000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: 1_700_000_000_000 + i * 3_600_000,
    open: closePrice,
    high: closePrice + 10,
    low: closePrice - 10,
    close: closePrice,
    volume: 1000,
    confirm: true,
  }));
}

/**
 * EMA20'nin belirli bir değere convergence etmesi için: son mumu
 * farklı bir fiyata set ediyoruz, önceki 99 mumu base'de tutuyoruz.
 * EMA flat yüklü diziden başlar, son mum sapma yaratır.
 */
function makeCandlesWithLastClose(lastClose: number, baseClose = 50000, count = 100): Candle[] {
  const candles = makeCandles(count, baseClose);
  candles[count - 1] = { ...candles[count - 1], close: lastClose };
  return candles;
}

// ─────────────────────────────────────────────────────────────
// computeTimeframeTrend
// ─────────────────────────────────────────────────────────────

describe("computeTimeframeTrend()", () => {
  it("< 20 mum → flat, ema20=null, deviation=0", () => {
    const r = computeTimeframeTrend("1h", makeCandles(19));
    expect(r.direction).toBe("flat");
    expect(r.ema20).toBeNull();
    expect(r.lastClose).toBeNull();
    expect(r.deviation).toBe(0);
  });

  it("tam 20 mum → hesaplanabilir", () => {
    const r = computeTimeframeTrend("1h", makeCandles(20));
    expect(r.ema20).not.toBeNull();
    expect(r.lastClose).not.toBeNull();
  });

  it("boş dizi → flat", () => {
    const r = computeTimeframeTrend("4h", []);
    expect(r.direction).toBe("flat");
    expect(r.ema20).toBeNull();
  });

  it("düz fiyat → flat (deviation ≈ 0)", () => {
    // 100 mum sabit fiyat → EMA ≈ close → deviation ≈ 0 → flat
    const r = computeTimeframeTrend("1h", makeCandles(100, 50000));
    expect(r.direction).toBe("flat");
    expect(Math.abs(r.deviation)).toBeLessThan(0.001);
  });

  it("son mum EMA üstünde +0.5% → up", () => {
    // 100 mum base=50000, son mum =50250 (+0.5% > FLAT_THRESHOLD=0.1%)
    const candles = makeCandlesWithLastClose(50250, 50000, 100);
    const r = computeTimeframeTrend("1h", candles);
    expect(r.direction).toBe("up");
    expect(r.deviation).toBeGreaterThan(0.001);
  });

  it("son mum EMA altında -0.5% → down", () => {
    const candles = makeCandlesWithLastClose(49750, 50000, 100);
    const r = computeTimeframeTrend("4h", candles);
    expect(r.direction).toBe("down");
    expect(r.deviation).toBeLessThan(-0.001);
  });

  it("tf etiketi doğru taşınır", () => {
    const r = computeTimeframeTrend("1d", makeCandles(50));
    expect(r.tf).toBe("1d");
  });

  it("deviation = (close - ema20) / ema20 işareti doğru (up → pozitif)", () => {
    const candles = makeCandlesWithLastClose(50500, 50000, 100);
    const r = computeTimeframeTrend("1h", candles);
    if (r.direction === "up") {
      expect(r.deviation).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// computeMtfTrend — cls sınıfları
// ─────────────────────────────────────────────────────────────

describe("computeMtfTrend() — cls sınıfları", () => {
  it("3 up → strong_up", () => {
    const up = makeCandlesWithLastClose(50500, 50000, 100);
    const r = computeMtfTrend("BTC", up, up, up);
    expect(r.cls).toBe("strong_up");
    expect(r.upCount).toBe(3);
    expect(r.downCount).toBe(0);
  });

  it("3 down → strong_down", () => {
    const down = makeCandlesWithLastClose(49500, 50000, 100);
    const r = computeMtfTrend("BTC", down, down, down);
    expect(r.cls).toBe("strong_down");
    expect(r.downCount).toBe(3);
    expect(r.upCount).toBe(0);
  });

  it("2 up, 1 flat (0 down) → up", () => {
    const up = makeCandlesWithLastClose(50500, 50000, 100);
    const flat = makeCandles(100, 50000);
    const r = computeMtfTrend("ETH", up, up, flat);
    expect(r.cls).toBe("up");
    expect(r.upCount).toBe(2);
    expect(r.flatCount).toBe(1);
  });

  it("2 down, 1 flat (0 up) → down", () => {
    const down = makeCandlesWithLastClose(49500, 50000, 100);
    const flat = makeCandles(100, 50000);
    const r = computeMtfTrend("BTC", down, down, flat);
    expect(r.cls).toBe("down");
    expect(r.downCount).toBe(2);
  });

  it("1 up, 1 down, 1 flat → mixed", () => {
    const up = makeCandlesWithLastClose(50500, 50000, 100);
    const down = makeCandlesWithLastClose(49500, 50000, 100);
    const flat = makeCandles(100, 50000);
    const r = computeMtfTrend("BTC", up, down, flat);
    expect(r.cls).toBe("mixed");
  });

  it("2 up, 1 down → mixed (downCount>0 → up koşulu sağlanmaz)", () => {
    const up = makeCandlesWithLastClose(50500, 50000, 100);
    const down = makeCandlesWithLastClose(49500, 50000, 100);
    const r = computeMtfTrend("ETH", up, up, down);
    expect(r.cls).toBe("mixed");
  });

  it("tüm TF < 20 mum → no_data", () => {
    const short = makeCandles(5);
    const r = computeMtfTrend("BTC", short, short, short);
    expect(r.cls).toBe("no_data");
  });

  it("pair pass-through ETH", () => {
    const r = computeMtfTrend("ETH", makeCandles(50), makeCandles(50), makeCandles(50));
    expect(r.pair).toBe("ETH");
  });

  it("trends dizisi 3 elemanlı, tf etiketleri doğru sırada", () => {
    const c = makeCandles(50);
    const r = computeMtfTrend("BTC", c, c, c);
    expect(r.trends).toHaveLength(3);
    expect(r.trends[0].tf).toBe("1h");
    expect(r.trends[1].tf).toBe("4h");
    expect(r.trends[2].tf).toBe("1d");
  });

  it("flatCount doğru — 3 flat → flatCount=3", () => {
    const flat = makeCandles(100, 50000);
    const r = computeMtfTrend("BTC", flat, flat, flat);
    expect(r.flatCount).toBe(3);
    // 3 flat: upCount=0, downCount=0 → cls=mixed (no strong_up/down condition met)
    expect(r.upCount).toBe(0);
    expect(r.downCount).toBe(0);
  });
});
