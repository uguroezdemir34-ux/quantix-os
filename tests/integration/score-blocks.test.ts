/**
 * SCORE BLOCKS — Hard + Soft block kuralları tam kapsama.
 *
 * checkVolBreakoutOverride, checkOverextended, checkNeutralDirection,
 * checkCounterTrend, checkAdxWeakOrTired, checkRsiExtreme, checkBbOutOfBand,
 * checkVwapExtreme, checkVolumeLow, checkFundingExtreme, checkTimeQuality,
 * checkEventSkip, checkBtcCooldown, checkBtcSelfCooldown,
 * checkDailyTrendOpposite, checkFundingCrowded, checkLockReleaseRamp,
 * checkCorrelationCluster, checkAtrRegime
 */

import { describe, it, expect } from "vitest";
import {
  checkVolBreakoutOverride,
  checkOverextended,
  checkNeutralDirection,
  checkCounterTrend,
  checkAdxWeakOrTired,
  checkRsiExtreme,
  checkBbOutOfBand,
  checkVwapExtreme,
  checkVolumeLow,
  checkFundingExtreme,
  checkTimeQuality,
  checkEventSkip,
  checkBtcCooldown,
  checkBtcSelfCooldown,
  checkDailyTrendOpposite,
  checkFundingCrowded,
  checkLockReleaseRamp,
  checkCorrelationCluster,
  checkAtrRegime,
} from "@/lib/score/blocks";

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;

// ─────────────────────────────────────────────────────────────
// checkVolBreakoutOverride
// ─────────────────────────────────────────────────────────────

describe("checkVolBreakoutOverride()", () => {
  const base = {
    direction: "LONG" as const,
    volRatio: 3.5,
    adx: 30,
    baseScore: 80,
    last4hMovePct: 2.5,
    trend4hUp: true,
    trend4hDown: false,
  };

  it("all conditions met LONG → active", () => {
    expect(checkVolBreakoutOverride(base).active).toBe(true);
  });

  it("all conditions met SHORT → active", () => {
    const r = checkVolBreakoutOverride({
      ...base, direction: "SHORT", last4hMovePct: -2.5, trend4hUp: false, trend4hDown: true,
    });
    expect(r.active).toBe(true);
  });

  it("NEUTRAL → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, direction: "NEUTRAL" }).active).toBe(false);
  });

  it("volRatio < 3.0 → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, volRatio: 2.9 }).active).toBe(false);
  });

  it("adx < 25 → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, adx: 24 }).active).toBe(false);
  });

  it("baseScore < 75 → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, baseScore: 74 }).active).toBe(false);
  });

  it("last4hMovePct null → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, last4hMovePct: null }).active).toBe(false);
  });

  it("LONG but last4hMovePct < 2.0 → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, last4hMovePct: 1.5 }).active).toBe(false);
  });

  it("LONG but trend4hUp=false → not active", () => {
    expect(checkVolBreakoutOverride({ ...base, trend4hUp: false }).active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// checkOverextended (2+ flags → hard block)
// ─────────────────────────────────────────────────────────────

describe("checkOverextended()", () => {
  const vwap = { vwap: 50000, stddev: 1000 };

  it("NEUTRAL → null (no check)", () => {
    expect(checkOverextended({ direction: "NEUTRAL", rsi: 80, bbPct: 0.9, vwap, px: 52000 })).toBeNull();
  });

  it("LONG: RSI>70 + BB>0.80 → 2 flags → hard block", () => {
    const r = checkOverextended({ direction: "LONG", rsi: 75, bbPct: 0.85, vwap: null, px: 50000 });
    expect(r).not.toBeNull();
    expect(r).toContain("RSI");
    expect(r).toContain("BB");
  });

  it("LONG: RSI>70 only → 1 flag → null (not blocked)", () => {
    expect(checkOverextended({ direction: "LONG", rsi: 75, bbPct: 0.5, vwap: null, px: 50000 })).toBeNull();
  });

  it("LONG: BB>0.80 + VWAP +1.4σ → 2 flags → hard block", () => {
    const r = checkOverextended({ direction: "LONG", rsi: 60, bbPct: 0.85, vwap, px: 51400 });
    expect(r).not.toBeNull();
  });

  it("SHORT: RSI<30 + BB<0.20 → 2 flags → hard block", () => {
    const r = checkOverextended({ direction: "SHORT", rsi: 25, bbPct: 0.15, vwap: null, px: 50000 });
    expect(r).not.toBeNull();
  });

  it("SHORT: only RSI<30 → 1 flag → null", () => {
    expect(checkOverextended({ direction: "SHORT", rsi: 25, bbPct: 0.5, vwap: null, px: 50000 })).toBeNull();
  });

  it("SHORT: BB<0.20 + VWAP -1.4σ → 2 flags → hard block", () => {
    const r = checkOverextended({ direction: "SHORT", rsi: 45, bbPct: 0.15, vwap, px: 48600 }); // -1.4σ
    expect(r).not.toBeNull();
  });

  it("all flags normal → null", () => {
    expect(checkOverextended({ direction: "LONG", rsi: 55, bbPct: 0.5, vwap, px: 50200 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Simple block functions
// ─────────────────────────────────────────────────────────────

describe("checkNeutralDirection()", () => {
  it("NEUTRAL → block string", () => expect(checkNeutralDirection("NEUTRAL")).not.toBeNull());
  it("LONG → null", () => expect(checkNeutralDirection("LONG")).toBeNull());
  it("SHORT → null", () => expect(checkNeutralDirection("SHORT")).toBeNull());
});

describe("checkCounterTrend()", () => {
  it("counterTrend=true → block string", () => expect(checkCounterTrend(true)).not.toBeNull());
  it("counterTrend=false → null", () => expect(checkCounterTrend(false)).toBeNull());
});

describe("checkAdxWeakOrTired()", () => {
  it("null → null", () => expect(checkAdxWeakOrTired(null)).toBeNull());
  it("ADX < 20 → block (weak)", () => {
    const r = checkAdxWeakOrTired(15);
    expect(r).not.toBeNull();
    expect(r).toContain("zayıf");
  });
  it("ADX > 50 → block (tired)", () => {
    const r = checkAdxWeakOrTired(55);
    expect(r).not.toBeNull();
    expect(r).toContain("yorgun");
  });
  it("ADX 20-50 → null", () => {
    expect(checkAdxWeakOrTired(30)).toBeNull();
    expect(checkAdxWeakOrTired(50)).toBeNull();
  });
  it("boundary: ADX exactly 20 → null", () => expect(checkAdxWeakOrTired(20)).toBeNull());
});

// ─────────────────────────────────────────────────────────────
// checkRsiExtreme (regime relax)
// ─────────────────────────────────────────────────────────────

describe("checkRsiExtreme()", () => {
  it("null → null", () => expect(checkRsiExtreme({ rsi: null, direction: "LONG", regime: "trending_strong" })).toBeNull());

  it("LONG RSI > 75 → hard block", () => {
    expect(checkRsiExtreme({ rsi: 76, direction: "LONG", regime: "ranging" })).not.toBeNull();
  });

  it("LONG RSI = 75 → null (boundary, not exceeded)", () => {
    expect(checkRsiExtreme({ rsi: 75, direction: "LONG", regime: "ranging" })).toBeNull();
  });

  it("SHORT RSI < 25 → hard block", () => {
    expect(checkRsiExtreme({ rsi: 24, direction: "SHORT", regime: "ranging" })).not.toBeNull();
  });

  it("trending_strong relaxes LONG threshold to 80", () => {
    // RSI 77 normally blocked, but trending_strong LONG → threshold 80 → ok
    expect(checkRsiExtreme({ rsi: 77, direction: "LONG", regime: "trending_strong" })).toBeNull();
    // RSI 81 → still blocked even with relax
    expect(checkRsiExtreme({ rsi: 81, direction: "LONG", regime: "trending_strong" })).not.toBeNull();
  });

  it("trending_strong relaxes SHORT threshold to 20", () => {
    expect(checkRsiExtreme({ rsi: 22, direction: "SHORT", regime: "trending_strong" })).toBeNull();
    expect(checkRsiExtreme({ rsi: 19, direction: "SHORT", regime: "trending_strong" })).not.toBeNull();
  });

  it("trending_strong does NOT relax for wrong direction", () => {
    // trending_strong SHORT relax doesn't apply to LONG
    expect(checkRsiExtreme({ rsi: 77, direction: "LONG", regime: "trending_weak" })).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// checkBbOutOfBand
// ─────────────────────────────────────────────────────────────

describe("checkBbOutOfBand()", () => {
  it("volBreakoutActive=true → empty array", () => {
    expect(checkBbOutOfBand(0.99, true)).toHaveLength(0);
  });
  it("bbPct null → empty", () => expect(checkBbOutOfBand(null, false)).toHaveLength(0));
  it("bbPct > 0.97 → upper band block", () => {
    const r = checkBbOutOfBand(0.98, false);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toContain("üst");
  });
  it("bbPct < 0.03 → lower band block", () => {
    expect(checkBbOutOfBand(0.01, false)[0]).toContain("alt");
  });
  it("bbPct in normal range → empty", () => {
    expect(checkBbOutOfBand(0.5, false)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// checkVwapExtreme
// ─────────────────────────────────────────────────────────────

describe("checkVwapExtreme()", () => {
  const vwap = { vwap: 50000, stddev: 1000 };
  it("null → null", () => expect(checkVwapExtreme(null, 50000)).toBeNull());
  it("stddev=0 → null", () => expect(checkVwapExtreme({ vwap: 50000, stddev: 0 }, 52000)).toBeNull());
  it("> 2σ away → block", () => {
    expect(checkVwapExtreme(vwap, 52100)).not.toBeNull(); // +2.1σ
  });
  it("≤ 2σ → null", () => {
    expect(checkVwapExtreme(vwap, 52000)).toBeNull(); // exactly 2σ
  });
  it("below by > 2σ → block", () => {
    expect(checkVwapExtreme(vwap, 47900)).not.toBeNull(); // -2.1σ
  });
});

// ─────────────────────────────────────────────────────────────
// checkVolumeLow
// ─────────────────────────────────────────────────────────────

describe("checkVolumeLow()", () => {
  it("null → null", () => expect(checkVolumeLow(null)).toBeNull());
  it("< 0.7x → block", () => expect(checkVolumeLow(0.5)).not.toBeNull());
  it("= 0.7x → null (boundary ok)", () => expect(checkVolumeLow(0.7)).toBeNull());
  it("> 0.7x → null", () => expect(checkVolumeLow(1.5)).toBeNull());
});

// ─────────────────────────────────────────────────────────────
// checkFundingExtreme
// ─────────────────────────────────────────────────────────────

describe("checkFundingExtreme()", () => {
  it("null → null", () => expect(checkFundingExtreme(null)).toBeNull());
  it("|fr| > 0.06% → block", () => {
    expect(checkFundingExtreme(0.0007)).not.toBeNull();   // +0.07%
    expect(checkFundingExtreme(-0.0007)).not.toBeNull();  // -0.07%
  });
  it("|fr| ≤ 0.06% → null", () => {
    expect(checkFundingExtreme(0.0006)).toBeNull();       // exactly 0.06%
    expect(checkFundingExtreme(0.0003)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// checkTimeQuality
// ─────────────────────────────────────────────────────────────

describe("checkTimeQuality()", () => {
  it("quality=0 → block with reason", () => {
    const r = checkTimeQuality({ quality: 0, reason: "Kötü zaman" });
    expect(r).toBe("Kötü zaman");
  });
  it("quality > 0 → null", () => {
    expect(checkTimeQuality({ quality: 1, reason: "iyi" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// checkEventSkip
// ─────────────────────────────────────────────────────────────

describe("checkEventSkip()", () => {
  it("null eventSkipUntil → null", () => {
    expect(checkEventSkip({ eventSkipUntil: null, now: NOW })).toBeNull();
  });
  it("eventSkipUntil in past → null", () => {
    expect(checkEventSkip({ eventSkipUntil: NOW - 1000, now: NOW })).toBeNull();
  });
  it("eventSkipUntil in future → block with remaining time", () => {
    const r = checkEventSkip({ eventSkipUntil: NOW + 30 * MIN, now: NOW });
    expect(r).not.toBeNull();
    expect(r).toContain("30dk");
  });
  it("remaining ≥ 60 min → shows hours format", () => {
    const r = checkEventSkip({ eventSkipUntil: NOW + 90 * MIN, now: NOW });
    expect(r).toContain("sa");
  });
});

// ─────────────────────────────────────────────────────────────
// checkBtcCooldown
// ─────────────────────────────────────────────────────────────

describe("checkBtcCooldown()", () => {
  it("pair=BTC → null (only for alts)", () => {
    expect(checkBtcCooldown({ pair: "BTC", btcCooldownUntil: NOW + HOUR, btcCooldownReason: "", now: NOW })).toBeNull();
  });
  it("no cooldown → null", () => {
    expect(checkBtcCooldown({ pair: "ETH", btcCooldownUntil: null, btcCooldownReason: "", now: NOW })).toBeNull();
  });
  it("cooldown expired → null", () => {
    expect(checkBtcCooldown({ pair: "ETH", btcCooldownUntil: NOW - 1000, btcCooldownReason: "", now: NOW })).toBeNull();
  });
  it("cooldown active for ETH → block with minutes", () => {
    const r = checkBtcCooldown({ pair: "ETH", btcCooldownUntil: NOW + 20 * MIN, btcCooldownReason: "spike", now: NOW });
    expect(r).not.toBeNull();
    expect(r).toContain("20");
    expect(r).toContain("spike");
  });
});

// ─────────────────────────────────────────────────────────────
// checkBtcSelfCooldown
// ─────────────────────────────────────────────────────────────

describe("checkBtcSelfCooldown()", () => {
  it("pair=ETH → null (only for BTC)", () => {
    expect(checkBtcSelfCooldown({ pair: "ETH", btcSelfCooldownUntil: NOW + HOUR, btcCooldownReason: "", now: NOW })).toBeNull();
  });
  it("no cooldown → null", () => {
    expect(checkBtcSelfCooldown({ pair: "BTC", btcSelfCooldownUntil: null, btcCooldownReason: "", now: NOW })).toBeNull();
  });
  it("BTC cooldown active → block", () => {
    const r = checkBtcSelfCooldown({ pair: "BTC", btcSelfCooldownUntil: NOW + 15 * MIN, btcCooldownReason: "", now: NOW });
    expect(r).not.toBeNull();
    expect(r).toContain("15");
  });
});

// ─────────────────────────────────────────────────────────────
// checkDailyTrendOpposite (soft block)
// ─────────────────────────────────────────────────────────────

describe("checkDailyTrendOpposite()", () => {
  it("null ema50_1d → null", () => {
    expect(checkDailyTrendOpposite({ direction: "LONG", px: 50000, ema50_1d: null })).toBeNull();
  });
  it("LONG below daily EMA50 → soft block", () => {
    expect(checkDailyTrendOpposite({ direction: "LONG", px: 40000, ema50_1d: 45000 })).not.toBeNull();
  });
  it("LONG above daily EMA50 → null", () => {
    expect(checkDailyTrendOpposite({ direction: "LONG", px: 50000, ema50_1d: 45000 })).toBeNull();
  });
  it("SHORT above daily EMA50 → soft block", () => {
    expect(checkDailyTrendOpposite({ direction: "SHORT", px: 50000, ema50_1d: 45000 })).not.toBeNull();
  });
  it("SHORT below daily EMA50 → null", () => {
    expect(checkDailyTrendOpposite({ direction: "SHORT", px: 40000, ema50_1d: 45000 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// checkFundingCrowded (soft block, 0.04-0.06% range)
// ─────────────────────────────────────────────────────────────

describe("checkFundingCrowded()", () => {
  it("null → null", () => expect(checkFundingCrowded(null, "LONG")).toBeNull());
  it("NEUTRAL → null", () => expect(checkFundingCrowded(0.0005, "NEUTRAL")).toBeNull());

  it("LONG + fr 0.04-0.06% → soft block", () => {
    expect(checkFundingCrowded(0.0005, "LONG")).not.toBeNull(); // +0.05%
  });
  it("SHORT + fr -0.04 to -0.06% → soft block", () => {
    expect(checkFundingCrowded(-0.0005, "SHORT")).not.toBeNull(); // -0.05%
  });

  it("LONG + negative fr in range → null (not crowded longs)", () => {
    expect(checkFundingCrowded(-0.0005, "LONG")).toBeNull();
  });

  it("fr outside 0.04-0.06% range → null", () => {
    expect(checkFundingCrowded(0.0003, "LONG")).toBeNull(); // 0.03% (below threshold)
    expect(checkFundingCrowded(0.0008, "LONG")).toBeNull(); // 0.08% (above — handled by extreme block)
  });
});

// ─────────────────────────────────────────────────────────────
// checkLockReleaseRamp
// ─────────────────────────────────────────────────────────────

describe("checkLockReleaseRamp()", () => {
  it("null lockReleasedAt → not active", () => {
    expect(checkLockReleaseRamp({ lockReleasedAt: null, now: NOW }).active).toBe(false);
  });
  it("released > 24h ago → not active", () => {
    const r = checkLockReleaseRamp({ lockReleasedAt: NOW - 25 * HOUR, now: NOW });
    expect(r.active).toBe(false);
  });
  it("released < 24h ago → active with message", () => {
    const r = checkLockReleaseRamp({ lockReleasedAt: NOW - 2 * HOUR, now: NOW });
    expect(r.active).toBe(true);
    expect(r.message).not.toBeNull();
    expect(r.message).toContain("2.0");
  });
  it("boundary: exactly 24h → not active", () => {
    const r = checkLockReleaseRamp({ lockReleasedAt: NOW - 24 * HOUR, now: NOW });
    expect(r.active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// checkCorrelationCluster
// ─────────────────────────────────────────────────────────────

describe("checkCorrelationCluster()", () => {
  it("no open positions → null", () => {
    expect(checkCorrelationCluster({ pair: "BTC", direction: "LONG", openPositions: [] })).toBeNull();
  });
  it("NEUTRAL direction → null", () => {
    expect(checkCorrelationCluster({
      pair: "BTC", direction: "NEUTRAL",
      openPositions: [{ pair: "ETH", direction: "LONG" }],
    })).toBeNull();
  });
  it("BTC LONG + ETH LONG open → cluster block", () => {
    const r = checkCorrelationCluster({
      pair: "BTC", direction: "LONG",
      openPositions: [{ pair: "ETH", direction: "LONG" }],
    });
    expect(r).not.toBeNull();
    expect(r).toContain("ETH");
  });
  it("BTC LONG + ETH SHORT open → null (hedge, no block)", () => {
    expect(checkCorrelationCluster({
      pair: "BTC", direction: "LONG",
      openPositions: [{ pair: "ETH", direction: "SHORT" }],
    })).toBeNull();
  });
  it("ETH SHORT + BTC SHORT open → cluster block", () => {
    const r = checkCorrelationCluster({
      pair: "ETH", direction: "SHORT",
      openPositions: [{ pair: "BTC", direction: "SHORT" }],
    });
    expect(r).not.toBeNull();
    expect(r).toContain("BTC");
  });
  it("non-correlated pairs → null", () => {
    expect(checkCorrelationCluster({
      pair: "BTC", direction: "LONG",
      openPositions: [{ pair: "SOL", direction: "LONG" }],
    })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// checkAtrRegime
// ─────────────────────────────────────────────────────────────

describe("checkAtrRegime()", () => {
  it("null → adj=0, no blocks", () => {
    const r = checkAtrRegime({ percentile: null });
    expect(r.adj).toBe(0);
    expect(r.softBlock).toBeNull();
  });
  it("percentile < 20 → adj=-3 (compression, lower threshold)", () => {
    const r = checkAtrRegime({ percentile: 15 });
    expect(r.adj).toBe(-3);
    expect(r.softBlock).toBeNull();
  });
  it("percentile 20-80 → adj=0, no block (normal)", () => {
    const r = checkAtrRegime({ percentile: 50 });
    expect(r.adj).toBe(0);
    expect(r.softBlock).toBeNull();
  });
  it("percentile 81-95 → adj=+5, no soft block (expansion)", () => {
    const r = checkAtrRegime({ percentile: 85 });
    expect(r.adj).toBe(5);
    expect(r.softBlock).toBeNull();
  });
  it("percentile > 95 → adj=+5 + soft block (extreme)", () => {
    const r = checkAtrRegime({ percentile: 97 });
    expect(r.adj).toBe(5);
    expect(r.softBlock).not.toBeNull();
    expect(r.softBlock).toContain("extreme");
  });
  it("boundary: exactly 95 → no soft block", () => {
    expect(checkAtrRegime({ percentile: 95 }).softBlock).toBeNull();
  });
  it("boundary: exactly 96 → soft block", () => {
    expect(checkAtrRegime({ percentile: 96 }).softBlock).not.toBeNull();
  });
  it("reason always present when percentile given", () => {
    expect(checkAtrRegime({ percentile: 30 }).reason).not.toBeNull();
  });
});
