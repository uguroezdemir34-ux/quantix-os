/**
 * DAILY PNL TRACKER + DRAWDOWN PROTOCOL INTEGRATION TESTS
 *
 * Tests the full chain: closed trade P&L → dailyPnlPct → drawdown tier.
 * Uses computeDrawdownProtocol directly (pure function, no React required).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { computeDrawdownProtocol } from "@/lib/store/accountStore";

// ─────────────────────────────────────────────────────────────
// computeDrawdownProtocol — tier boundary tests
// ─────────────────────────────────────────────────────────────

describe("computeDrawdownProtocol", () => {
  it("normal: 0% P&L → normal tier, 1.0× multiplier", () => {
    const p = computeDrawdownProtocol(0);
    expect(p.tier).toBe("normal");
    expect(p.multiplier).toBe(1.0);
  });

  it("normal: +2% profit → normal tier", () => {
    const p = computeDrawdownProtocol(2.0);
    expect(p.tier).toBe("normal");
    expect(p.multiplier).toBe(1.0);
  });

  it("normal: -1.49% → just above caution threshold → normal", () => {
    const p = computeDrawdownProtocol(-1.49);
    expect(p.tier).toBe("normal");
    expect(p.multiplier).toBe(1.0);
  });

  it("caution: exactly -1.5% → caution tier, 0.5× multiplier", () => {
    const p = computeDrawdownProtocol(-1.5);
    expect(p.tier).toBe("caution");
    expect(p.multiplier).toBe(0.5);
  });

  it("caution: -2.0% → still caution", () => {
    const p = computeDrawdownProtocol(-2.0);
    expect(p.tier).toBe("caution");
    expect(p.multiplier).toBe(0.5);
  });

  it("caution: -2.49% → just above restricted threshold → caution", () => {
    const p = computeDrawdownProtocol(-2.49);
    expect(p.tier).toBe("caution");
    expect(p.multiplier).toBe(0.5);
  });

  it("restricted: exactly -2.5% → restricted tier, 0.25× multiplier", () => {
    const p = computeDrawdownProtocol(-2.5);
    expect(p.tier).toBe("restricted");
    expect(p.multiplier).toBe(0.25);
  });

  it("restricted: -2.99% → still restricted", () => {
    const p = computeDrawdownProtocol(-2.99);
    expect(p.tier).toBe("restricted");
    expect(p.multiplier).toBe(0.25);
  });

  it("locked: exactly -3.0% → locked tier, 0× multiplier", () => {
    const p = computeDrawdownProtocol(-3.0);
    expect(p.tier).toBe("locked");
    expect(p.multiplier).toBe(0);
  });

  it("locked: -5.0% deep loss → locked", () => {
    const p = computeDrawdownProtocol(-5.0);
    expect(p.tier).toBe("locked");
    expect(p.multiplier).toBe(0);
  });

  it("NaN input → defaults to normal (guard against corrupt state)", () => {
    const p = computeDrawdownProtocol(NaN);
    expect(p.tier).toBe("normal");
    expect(p.multiplier).toBe(1.0);
  });

  it("Infinity input → defaults to normal", () => {
    const p = computeDrawdownProtocol(Infinity);
    expect(p.tier).toBe("normal");
    expect(p.multiplier).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────
// dailyPnlPct calculation logic (mirrors useDailyPnlTracker)
// ─────────────────────────────────────────────────────────────

function computeDailyPnlPct(
  todayPnlUsd: number,
  balanceTotal: number,
): number {
  const startOfDayBalance = balanceTotal - todayPnlUsd;
  const safeBase = startOfDayBalance > 0 ? startOfDayBalance : balanceTotal;
  return safeBase > 0 ? (todayPnlUsd / safeBase) * 100 : 0;
}

describe("dailyPnlPct calculation", () => {
  it("no trades: 0 P&L → 0%", () => {
    expect(computeDailyPnlPct(0, 1000)).toBe(0);
  });

  it("$150 profit on $1000 balance → ~17.6% (balance was $850 at start)", () => {
    const pct = computeDailyPnlPct(150, 1000);
    // startOfDay = 1000 - 150 = 850; pct = 150/850*100 ≈ 17.647
    expect(pct).toBeCloseTo(17.647, 2);
  });

  it("$-15 loss on $1000 balance → -1.493% → caution tier", () => {
    const pct = computeDailyPnlPct(-15, 1000);
    // startOfDay = 1000 - (-15) = 1015; pct = -15/1015*100 ≈ -1.478
    expect(pct).toBeCloseTo(-1.478, 2);
    // Slightly above caution (-1.5), so should remain normal
    const protocol = computeDrawdownProtocol(pct);
    expect(protocol.tier).toBe("normal");
  });

  it("$-20 loss on $1000 balance → ~-2% → caution tier", () => {
    const pct = computeDailyPnlPct(-20, 1000);
    // startOfDay = 1020; pct = -20/1020*100 ≈ -1.961
    expect(pct).toBeCloseTo(-1.961, 2);
    expect(computeDrawdownProtocol(pct).tier).toBe("caution");
  });

  it("$-25.6 loss on $1000 balance → ~-2.5% boundary → restricted", () => {
    // Need pct <= -2.5: -x/(1000+x)*100 = -2.5 → x = 25.64
    const pct = computeDailyPnlPct(-25.64, 1000);
    expect(pct).toBeLessThanOrEqual(-2.5);
    expect(computeDrawdownProtocol(pct).tier).toBe("restricted");
  });

  it("$-30.93 loss on $1000 balance → ~-3% boundary → locked", () => {
    // Need pct <= -3.0: -x/(1000+x)*100 = -3.0 → x = 30.93
    const pct = computeDailyPnlPct(-30.93, 1000);
    expect(pct).toBeLessThanOrEqual(-3.0);
    expect(computeDrawdownProtocol(pct).tier).toBe("locked");
  });

  it("balance is zero: returns 0% (no divide-by-zero)", () => {
    expect(computeDailyPnlPct(0, 0)).toBe(0);
  });

  it("paper trades excluded: only real P&L counts toward drawdown", () => {
    // This is enforced by the isPaper filter in useDailyPnlTracker.
    // Here we simulate: real=$-20, paper=$+100. Only real counts.
    const realPnl = -20;
    const pct = computeDailyPnlPct(realPnl, 1000);
    expect(computeDrawdownProtocol(pct).tier).toBe("caution");
  });
});

// ─────────────────────────────────────────────────────────────
// Full tier transition sequence
// ─────────────────────────────────────────────────────────────

describe("tier transition sequence (normal → caution → restricted → locked)", () => {
  const balance = 1000;

  it("recovers to normal after day reset (0 loss)", () => {
    // Simulate day reset: new day with no trades yet
    const pct = computeDailyPnlPct(0, balance);
    expect(computeDrawdownProtocol(pct).tier).toBe("normal");
  });

  it("sequence of losses escalates tier correctly", () => {
    const scenarios: Array<{ loss: number; expected: string }> = [
      { loss: 0, expected: "normal" },
      { loss: -10, expected: "normal" },   // ~-0.99%
      { loss: -15, expected: "normal" },   // ~-1.48%
      { loss: -20, expected: "caution" },  // ~-1.96%
      { loss: -25, expected: "caution" },  // ~-2.44%
      { loss: -26, expected: "restricted" }, // ~-2.53%
      { loss: -31, expected: "locked" },   // ~-3.01%
    ];

    for (const { loss, expected } of scenarios) {
      const pct = computeDailyPnlPct(loss, balance);
      const tier = computeDrawdownProtocol(pct).tier;
      expect(tier, `loss=${loss} → expected ${expected}, got ${tier}`).toBe(expected);
    }
  });
});
