/**
 * P&L COMPUTE + STATS TESTS
 *
 * computeDailyAggregates, fillMissingDays, computePnlStats,
 * filterLastNDays, winRateTier — doğrudan para hesabıyla ilgili.
 */

import { describe, it, expect } from "vitest";
import {
  computeDailyAggregates,
  fillMissingDays,
  formatDateKey,
  localDayStart,
} from "@/lib/pnl/compute";
import {
  computePnlStats,
  filterLastNDays,
  emptyPnlStats,
} from "@/lib/pnl/stats";
import { winRateTier } from "@/lib/pnl/types";
import type { TradeRecord } from "@/lib/pnl/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const TZ = 0; // UTC throughout tests (deterministic)

function tradeAt(
  closedAt: number,
  pnlUsd: number,
  pnlPct = pnlUsd / 1000,
): TradeRecord {
  return {
    closedAt,
    openedAt: closedAt - 3_600_000,
    pair: "BTC",
    direction: "LONG",
    pnlUsd,
    pnlPct,
  };
}

// Fixed date for reproducible tests: 2024-01-15 UTC
const DAY_MS = 86_400_000;
const JAN_15 = Date.UTC(2024, 0, 15, 12, 0, 0); // noon UTC Jan 15

// ─────────────────────────────────────────────────────────────
// formatDateKey
// ─────────────────────────────────────────────────────────────

describe("formatDateKey()", () => {
  it("formats Jan 15 UTC correctly", () => {
    expect(formatDateKey(JAN_15, TZ)).toBe("2024-01-15");
  });

  it("midnight UTC stays same day", () => {
    const midnight = Date.UTC(2024, 0, 15, 0, 0, 0);
    expect(formatDateKey(midnight, TZ)).toBe("2024-01-15");
  });

  it("23:59:59 UTC stays same day", () => {
    const nearMidnight = Date.UTC(2024, 0, 15, 23, 59, 59);
    expect(formatDateKey(nearMidnight, TZ)).toBe("2024-01-15");
  });
});

// ─────────────────────────────────────────────────────────────
// computeDailyAggregates
// ─────────────────────────────────────────────────────────────

describe("computeDailyAggregates()", () => {
  it("empty trades → empty array", () => {
    expect(computeDailyAggregates([], TZ)).toHaveLength(0);
  });

  it("single win → 1 aggregate, tradeCount=1, totalPnlUsd correct", () => {
    const trades = [tradeAt(JAN_15, 100)];
    const result = computeDailyAggregates(trades, TZ);
    expect(result).toHaveLength(1);
    expect(result[0].tradeCount).toBe(1);
    expect(result[0].totalPnlUsd).toBeCloseTo(100);
    expect(result[0].winCount).toBe(1);
    expect(result[0].lossCount).toBe(0);
  });

  it("multiple trades same day → single aggregate", () => {
    const trades = [
      tradeAt(JAN_15, 100),
      tradeAt(JAN_15 + 3600_000, -50), // 1 hour later, same day
    ];
    const result = computeDailyAggregates(trades, TZ);
    expect(result).toHaveLength(1);
    expect(result[0].tradeCount).toBe(2);
    expect(result[0].totalPnlUsd).toBeCloseTo(50);
    expect(result[0].winCount).toBe(1);
    expect(result[0].lossCount).toBe(1);
  });

  it("trades on different days → 2 aggregates, sorted ascending", () => {
    const trades = [
      tradeAt(JAN_15, 100),
      tradeAt(JAN_15 + DAY_MS, -50), // Jan 16
    ];
    const result = computeDailyAggregates(trades, TZ);
    expect(result).toHaveLength(2);
    // Sorted by date ascending
    expect(result[0].date).toBe("2024-01-15");
    expect(result[1].date).toBe("2024-01-16");
  });

  it("winRate is correct", () => {
    const trades = [
      tradeAt(JAN_15, 100),
      tradeAt(JAN_15 + 1000, 50),
      tradeAt(JAN_15 + 2000, -30),
    ];
    const result = computeDailyAggregates(trades, TZ);
    expect(result[0].winRate).toBeCloseTo(2 / 3);
  });

  it("breakeven trade (pnl=0) is neither win nor loss", () => {
    const trades = [tradeAt(JAN_15, 0)];
    const result = computeDailyAggregates(trades, TZ);
    expect(result[0].winCount).toBe(0);
    expect(result[0].lossCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// fillMissingDays
// ─────────────────────────────────────────────────────────────

describe("fillMissingDays()", () => {
  it("fills 7 days when no trades exist", () => {
    const result = fillMissingDays([], JAN_15, 7, TZ);
    expect(result).toHaveLength(7);
    expect(result.every((d) => d.tradeCount === 0)).toBe(true);
    expect(result.every((d) => d.totalPnlUsd === 0)).toBe(true);
  });

  it("trade days have real data, empty days have zeros", () => {
    const trades = [tradeAt(JAN_15, 100)];
    const aggs = computeDailyAggregates(trades, TZ);
    const result = fillMissingDays(aggs, JAN_15, 3, TZ);
    expect(result).toHaveLength(3);
    // Jan 15 should have trade data
    const jan15 = result.find((d) => d.date === "2024-01-15");
    expect(jan15?.tradeCount).toBe(1);
    expect(jan15?.totalPnlUsd).toBeCloseTo(100);
  });

  it("fills exactly N days", () => {
    const result = fillMissingDays([], JAN_15, 30, TZ);
    expect(result).toHaveLength(30);
  });

  it("days are in chronological order", () => {
    const result = fillMissingDays([], JAN_15, 5, TZ);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].dayStart).toBeGreaterThan(result[i - 1].dayStart);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// computePnlStats
// ─────────────────────────────────────────────────────────────

describe("computePnlStats()", () => {
  it("empty → emptyPnlStats defaults", () => {
    const stats = computePnlStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgR).toBeNull();
    expect(stats.profitFactor).toBeNull();
  });

  it("single win: winRate=1, grossProfit=pnl, grossLoss=0", () => {
    const stats = computePnlStats([tradeAt(JAN_15, 100)]);
    expect(stats.totalTrades).toBe(1);
    expect(stats.winRate).toBe(1);
    expect(stats.grossProfit).toBeCloseTo(100);
    expect(stats.grossLoss).toBe(0);
    expect(stats.profitFactor).toBe(Infinity);
  });

  it("single loss: winRate=0, grossLoss=|pnl|", () => {
    const stats = computePnlStats([tradeAt(JAN_15, -100)]);
    expect(stats.winRate).toBe(0);
    expect(stats.grossLoss).toBeCloseTo(100);
    expect(stats.profitFactor).toBeNull(); // no profit
  });

  it("avgR = avgWin / avgLoss", () => {
    const trades = [
      tradeAt(JAN_15, 200),     // win
      tradeAt(JAN_15 + 1000, 100),  // win
      tradeAt(JAN_15 + 2000, -100), // loss
    ];
    const stats = computePnlStats(trades);
    // avgWin = 150, avgLoss = 100, avgR = 1.5
    expect(stats.avgR).toBeCloseTo(1.5);
  });

  it("profitFactor = grossProfit / grossLoss", () => {
    const trades = [
      tradeAt(JAN_15, 300),
      tradeAt(JAN_15 + 1000, -100),
    ];
    const stats = computePnlStats(trades);
    expect(stats.profitFactor).toBeCloseTo(3.0);
  });

  it("maxDrawdown: peak-to-trough in cumulative P&L", () => {
    // Trades chronological: +100, +50, -200, +30
    // Cumulative: 100, 150, -50, -20
    // Peak at 150, trough at -50 → maxDd = 200
    const trades = [
      tradeAt(JAN_15, 100),
      tradeAt(JAN_15 + 1000, 50),
      tradeAt(JAN_15 + 2000, -200),
      tradeAt(JAN_15 + 3000, 30),
    ];
    const stats = computePnlStats(trades);
    expect(stats.maxDrawdownUsd).toBeCloseTo(200);
  });

  it("bestDay and worstDay identified correctly", () => {
    const trades = [
      tradeAt(JAN_15, 500),             // Jan 15: +500
      tradeAt(JAN_15 + DAY_MS, -300),   // Jan 16: -300
      tradeAt(JAN_15 + 2 * DAY_MS, 100), // Jan 17: +100
    ];
    const stats = computePnlStats(trades, TZ);
    expect(stats.bestDay?.totalPnlUsd).toBeCloseTo(500);
    expect(stats.worstDay?.totalPnlUsd).toBeCloseTo(-300);
  });

  it("breakeven trades count but don't affect win/loss", () => {
    const trades = [
      tradeAt(JAN_15, 0),
      tradeAt(JAN_15 + 1000, 100),
    ];
    const stats = computePnlStats(trades);
    expect(stats.totalTrades).toBe(2);
    expect(stats.winCount).toBe(1); // only the +100 win
    expect(stats.lossCount).toBe(0);
    expect(stats.winRate).toBeCloseTo(0.5); // 1/2
  });
});

// ─────────────────────────────────────────────────────────────
// filterLastNDays
// ─────────────────────────────────────────────────────────────

describe("filterLastNDays()", () => {
  const now = JAN_15;

  it("includes trades within window", () => {
    const trades = [tradeAt(now - DAY_MS, 100)]; // yesterday
    expect(filterLastNDays(trades, 7, now)).toHaveLength(1);
  });

  it("excludes trades outside window", () => {
    const trades = [tradeAt(now - 10 * DAY_MS, 100)]; // 10 days ago
    expect(filterLastNDays(trades, 7, now)).toHaveLength(0);
  });

  it("boundary: exactly N days ago is included", () => {
    const cutoff = now - 7 * DAY_MS;
    const trades = [tradeAt(cutoff, 100)];
    expect(filterLastNDays(trades, 7, now)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// winRateTier
// ─────────────────────────────────────────────────────────────

describe("winRateTier()", () => {
  it("≥ 60% → excellent", () => {
    expect(winRateTier(0.60)).toBe("excellent");
    expect(winRateTier(0.75)).toBe("excellent");
  });
  it("50-59% → good", () => {
    expect(winRateTier(0.50)).toBe("good");
    expect(winRateTier(0.59)).toBe("good");
  });
  it("40-49% → fair", () => {
    expect(winRateTier(0.40)).toBe("fair");
    expect(winRateTier(0.49)).toBe("fair");
  });
  it("< 40% → poor", () => {
    expect(winRateTier(0.39)).toBe("poor");
    expect(winRateTier(0)).toBe("poor");
  });
});
