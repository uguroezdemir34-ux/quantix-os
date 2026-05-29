import { describe, it, expect } from "vitest";
import { computePositionSize } from "@/lib/sizer/position";
import type { PositionSizerInput } from "@/lib/sizer/types";

function makeSizerInput(overrides?: Partial<PositionSizerInput>): PositionSizerInput {
  return {
    pair: "BTC",
    direction: "LONG",
    px: 50000,
    atr: 500,
    adx1h: 35,
    swingLow: 48000,
    swingHigh: 52000,
    balance: { total: 1000, free: 800 },
    drawdownProtocol: { tier: "normal", multiplier: 1, label: "Normal" },
    bucket: {
      n: 0,
      wr: null,
      isCut: false,
      isBoost: false,
      hasData: false,
      min: 80,
      max: 89,
    },
    score: 82,
    ...overrides,
  };
}

describe("computePositionSize()", () => {
  it("1. normal path — qty > 0, warnLevel:'ok', rr1 > 0, rr2 >= rr1", () => {
    const result = computePositionSize(makeSizerInput());
    expect(result.qty).toBeGreaterThan(0);
    expect(result.warnLevel).toBe("ok");
    expect(result.rr1).toBeGreaterThan(0);
    expect(result.rr2).toBeGreaterThanOrEqual(result.rr1);
  });

  it("2. locked tier — warnLevel:'blocked', warnKind:'locked'", () => {
    const result = computePositionSize(
      makeSizerInput({
        drawdownProtocol: { tier: "locked", multiplier: 0, label: "Locked" },
      }),
    );
    expect(result.warnLevel).toBe("blocked");
    expect(result.warnKind).toBe("locked");
  });

  it("3. insufficient free margin — warnLevel:'blocked', warnKind:'insufficient_margin'", () => {
    const result = computePositionSize(
      makeSizerInput({ balance: { total: 1000, free: 0.01 } }),
    );
    expect(result.warnLevel).toBe("blocked");
    expect(result.warnKind).toBe("insufficient_margin");
  });

  it("4. below min notional — warnLevel:'warning', warnKind:'below_min_size'", () => {
    const result = computePositionSize(
      makeSizerInput({
        balance: { total: 5, free: 5 },
        px: 50000,
        atr: 500,
      }),
    );
    expect(result.warnLevel).toBe("warning");
    expect(result.warnKind).toBe("below_min_size");
  });

  it("5. qty calculation sanity — qty ≈ riskUsd / stopDistance (within 1%)", () => {
    const result = computePositionSize(makeSizerInput());
    const { qty, risk, stop } = result;
    if (stop.stopDistance > 0) {
      const expected = risk.riskUsd / stop.stopDistance;
      const diff = Math.abs(qty - expected) / expected;
      expect(diff).toBeLessThan(0.01);
    }
  });
});
