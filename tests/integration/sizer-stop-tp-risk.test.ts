/**
 * SIZER — Stop, TP, Risk hesabı ve Position P&L testleri.
 *
 * computeStructuralStop: 5 kural (swing yok, yanlış taraf, çok yakın, çok uzak, ideal)
 * computeAdaptiveTPs: ADX weak/healthy/strong/null, NEUTRAL
 * computeRiskUsd: bakiye tiers, bucket adj, drawdown adj, locked=0
 * suggestLeverage: tier sınırları
 * computeLiveUpl, computeRoe, computeTpProgress, computeStopDistance,
 * categorizeHoldingDuration
 */

import { describe, it, expect } from "vitest";
import { computeStructuralStop } from "@/lib/sizer/stop";
import { computeAdaptiveTPs } from "@/lib/sizer/take-profit";
import { computeRiskUsd, suggestLeverage } from "@/lib/sizer/risk";
import { SIZER_CONFIG } from "@/lib/sizer/types";
import {
  computeLiveUpl,
  computeRoe,
  computeTpProgress,
  computeStopDistance,
  categorizeHoldingDuration,
} from "@/lib/sizer/position-pnl";
import type { Position } from "@/lib/okx/positions";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const ATR = 1000; // $1000 ATR
const PX = 50_000; // $50k BTC price

function makePos(overrides: Partial<Position> = {}): Position {
  return {
    instId: "BTC-USDT-SWAP",
    pair: "BTC",
    posSide: "long",
    direction: "LONG",
    size: 0.01,
    notional: 500,
    leverage: 10,
    entryPx: 50_000,
    markPx: 50_000,
    upl: 0,
    uplRatio: 0,
    mgnMode: "cross",
    liqPx: null,
    tpTriggerPx: null,
    slTriggerPx: null,
    cTime: Date.now() - 3_600_000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// computeStructuralStop
// ─────────────────────────────────────────────────────────────

describe("computeStructuralStop()", () => {
  it("NEUTRAL → stop at px, distance=0, kind=atr_no_pivot", () => {
    const r = computeStructuralStop("NEUTRAL", PX, ATR, null, null);
    expect(r.stopPrice).toBe(PX);
    expect(r.stopDistance).toBe(0);
    expect(r.kind).toBe("atr_no_pivot");
  });

  it("LONG no swing → ATR fallback (1.5× ATR below px)", () => {
    const r = computeStructuralStop("LONG", PX, ATR, null, null);
    expect(r.kind).toBe("atr_no_pivot");
    expect(r.stopPrice).toBeCloseTo(PX - 1.5 * ATR);
    expect(r.stopDistance).toBeCloseTo(1.5 * ATR);
  });

  it("SHORT no swing → ATR fallback above px", () => {
    const r = computeStructuralStop("SHORT", PX, ATR, null, null);
    expect(r.kind).toBe("atr_no_pivot");
    expect(r.stopPrice).toBeCloseTo(PX + 1.5 * ATR);
  });

  it("LONG swing wrong side (above price) → atr_invalid_pivot", () => {
    // swingLow above px → invalid
    const r = computeStructuralStop("LONG", PX, ATR, PX + 500, null);
    expect(r.kind).toBe("atr_invalid_pivot");
    expect(r.stopPrice).toBeCloseTo(PX - 1.5 * ATR);
  });

  it("LONG swing too close (< 0.8× ATR) → widened (1.0× ATR)", () => {
    // candidateDist = PX - (swingLow - 0.3×ATR) = PX - (PX-200 - 300) = 500
    // 0.8×ATR = 800 → 500 < 800 → too close → widened
    const swingLow = PX - 200; // very close swing
    const r = computeStructuralStop("LONG", PX, ATR, swingLow, null);
    expect(r.kind).toBe("widened");
    expect(r.stopDistance).toBeCloseTo(SIZER_CONFIG.WIDENED_STOP_MULT * ATR);
  });

  it("LONG swing too far (> 2.5× ATR) → atr_too_far fallback", () => {
    // candidateDist = PX - (swingLow - 0.3×ATR) = PX - (PX-3500-300) = 3800
    // 2.5×ATR = 2500 → 3800 > 2500 → too far
    const swingLow = PX - 3500;
    const r = computeStructuralStop("LONG", PX, ATR, swingLow, null);
    expect(r.kind).toBe("atr_too_far");
    expect(r.stopPrice).toBeCloseTo(PX - 1.5 * ATR);
  });

  it("LONG swing ideal range → structural stop", () => {
    // swingLow = PX - 1500: candidate = 1500 - 300 = 1200 dist
    // 0.8×ATR=800 < 1200 < 2.5×ATR=2500 → structural
    const swingLow = PX - 1500;
    const r = computeStructuralStop("LONG", PX, ATR, swingLow, null);
    expect(r.kind).toBe("structural");
    expect(r.stopPrice).toBeCloseTo(swingLow - SIZER_CONFIG.STOP_BUFFER_ATR * ATR);
    expect(r.swingLevel).toBe(swingLow);
  });

  it("SHORT swing ideal range → structural stop above px", () => {
    const swingHigh = PX + 1500;
    const r = computeStructuralStop("SHORT", PX, ATR, null, swingHigh);
    expect(r.kind).toBe("structural");
    expect(r.stopPrice).toBeCloseTo(swingHigh + SIZER_CONFIG.STOP_BUFFER_ATR * ATR);
  });
});

// ─────────────────────────────────────────────────────────────
// computeAdaptiveTPs
// ─────────────────────────────────────────────────────────────

describe("computeAdaptiveTPs()", () => {
  it("NEUTRAL → tp1=tp2=px, mode=healthy_fallback", () => {
    const r = computeAdaptiveTPs("NEUTRAL", PX, ATR, 30);
    expect(r.tp1Price).toBe(PX);
    expect(r.tp2Price).toBe(PX);
    expect(r.mode).toBe("healthy_fallback");
  });

  it("ADX null → healthy_fallback (2.5× / 4.0×)", () => {
    const r = computeAdaptiveTPs("LONG", PX, ATR, null);
    expect(r.mode).toBe("healthy_fallback");
    expect(r.tp1Mult).toBe(2.5);
    expect(r.tp2Mult).toBe(4.0);
    expect(r.tp1Price).toBeCloseTo(PX + 2.5 * ATR);
    expect(r.tp2Price).toBeCloseTo(PX + 4.0 * ATR);
  });

  it("ADX < 25 → weak (2.0× / 3.0×)", () => {
    const r = computeAdaptiveTPs("LONG", PX, ATR, 20);
    expect(r.mode).toBe("weak");
    expect(r.tp1Mult).toBe(2.0);
    expect(r.tp2Mult).toBe(3.0);
  });

  it("ADX 25-34 → healthy (2.5× / 4.0×)", () => {
    const r = computeAdaptiveTPs("LONG", PX, ATR, 28);
    expect(r.mode).toBe("healthy");
    expect(r.tp1Mult).toBe(2.5);
  });

  it("ADX >= 35 → strong (3.0× / 5.0×)", () => {
    const r = computeAdaptiveTPs("LONG", PX, ATR, 40);
    expect(r.mode).toBe("strong");
    expect(r.tp1Mult).toBe(3.0);
    expect(r.tp2Mult).toBe(5.0);
  });

  it("SHORT: TP prices below px", () => {
    const r = computeAdaptiveTPs("SHORT", PX, ATR, 30);
    expect(r.tp1Price).toBeLessThan(PX);
    expect(r.tp2Price).toBeLessThan(r.tp1Price);
    expect(r.tp1Price).toBeCloseTo(PX - 2.5 * ATR);
  });

  it("ADX boundary: exactly 25 → healthy", () => {
    const r = computeAdaptiveTPs("LONG", PX, ATR, 25);
    expect(r.mode).toBe("healthy");
  });

  it("ADX boundary: exactly 35 → strong", () => {
    const r = computeAdaptiveTPs("LONG", PX, ATR, 35);
    expect(r.mode).toBe("strong");
  });
});

// ─────────────────────────────────────────────────────────────
// computeRiskUsd
// ─────────────────────────────────────────────────────────────

const neutralBucket = { isCut: false, isBoost: false, n: 0, hasData: false };
const normalProtocol = { tier: "normal" as const, multiplier: 1.0 };

describe("computeRiskUsd()", () => {
  it("balance < 200 → baseRisk 0.5%", () => {
    const r = computeRiskUsd({ balance: 100, bucket: neutralBucket, drawdownProtocol: normalProtocol });
    expect(r.baseRiskPct).toBe(0.005);
    expect(r.riskUsd).toBeCloseTo(0.5);
  });

  it("balance 200-999 → baseRisk 1%", () => {
    const r = computeRiskUsd({ balance: 500, bucket: neutralBucket, drawdownProtocol: normalProtocol });
    expect(r.baseRiskPct).toBe(0.01);
    expect(r.riskUsd).toBeCloseTo(5.0);
  });

  it("balance >= 1000 → baseRisk 1.5%", () => {
    const r = computeRiskUsd({ balance: 5000, bucket: neutralBucket, drawdownProtocol: normalProtocol });
    expect(r.baseRiskPct).toBe(0.015);
    expect(r.riskUsd).toBeCloseTo(75.0);
  });

  it("isCut bucket → 0.5× adjustment", () => {
    const r = computeRiskUsd({
      balance: 5000,
      bucket: { isCut: true, isBoost: false, n: 10, hasData: true },
      drawdownProtocol: normalProtocol,
    });
    expect(r.bucketAdj).toBe(SIZER_CONFIG.BUCKET_CUT_ADJ);
    expect(r.riskUsd).toBeCloseTo(5000 * 0.015 * 0.5);
  });

  it("isBoost bucket → 1.25× adjustment", () => {
    const r = computeRiskUsd({
      balance: 5000,
      bucket: { isCut: false, isBoost: true, n: 10, hasData: true },
      drawdownProtocol: normalProtocol,
    });
    expect(r.bucketAdj).toBe(SIZER_CONFIG.BUCKET_BOOST_ADJ);
    expect(r.riskUsd).toBeCloseTo(5000 * 0.015 * 1.25);
  });

  it("caution drawdown → multiplier applied", () => {
    const r = computeRiskUsd({
      balance: 5000,
      bucket: neutralBucket,
      drawdownProtocol: { tier: "caution", multiplier: 0.5 },
    });
    expect(r.ddAdj).toBe(0.5);
    expect(r.riskUsd).toBeCloseTo(5000 * 0.015 * 0.5);
  });

  it("locked drawdown → multiplier=0 → riskUsd=0", () => {
    const r = computeRiskUsd({
      balance: 5000,
      bucket: neutralBucket,
      drawdownProtocol: { tier: "locked", multiplier: 0 },
    });
    expect(r.riskUsd).toBe(0);
  });

  it("normal tier → ddAdj=1.0", () => {
    const r = computeRiskUsd({ balance: 5000, bucket: neutralBucket, drawdownProtocol: normalProtocol });
    expect(r.ddAdj).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────
// suggestLeverage
// ─────────────────────────────────────────────────────────────

describe("suggestLeverage()", () => {
  it("balance < 50 → leverage 3", () => {
    expect(suggestLeverage(10)).toBe(3);
    expect(suggestLeverage(49)).toBe(3);
  });

  it("balance 50-199 → leverage 5", () => {
    expect(suggestLeverage(50)).toBe(5);
    expect(suggestLeverage(199)).toBe(5);
  });

  it("balance >= 200 → leverage 5", () => {
    expect(suggestLeverage(1000)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// computeLiveUpl
// ─────────────────────────────────────────────────────────────

describe("computeLiveUpl()", () => {
  it("LONG: price goes up → upl increases", () => {
    const pos = makePos({ direction: "LONG", size: 0.01, markPx: 50_000, upl: 0 });
    // size=0.01, price goes from 50k to 51k → delta=+10
    const result = computeLiveUpl(pos, 51_000);
    expect(result).toBeCloseTo(10);
  });

  it("SHORT: price goes up → upl decreases", () => {
    const pos = makePos({ direction: "SHORT", size: 0.01, markPx: 50_000, upl: 0 });
    const result = computeLiveUpl(pos, 51_000);
    expect(result).toBeCloseTo(-10);
  });

  it("currentPx <= 0 → returns pos.upl unchanged", () => {
    const pos = makePos({ upl: 42 });
    expect(computeLiveUpl(pos, 0)).toBe(42);
  });

  it("markPx <= 0 → returns pos.upl unchanged", () => {
    const pos = makePos({ markPx: 0, upl: 42 });
    expect(computeLiveUpl(pos, 50_000)).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────
// computeRoe
// ─────────────────────────────────────────────────────────────

describe("computeRoe()", () => {
  it("zero leverage → 0", () => {
    const pos = makePos({ leverage: 0 });
    expect(computeRoe(pos)).toBe(0);
  });

  it("breakeven → ROE = 0%", () => {
    const pos = makePos({ upl: 0, notional: 500, leverage: 10 });
    expect(computeRoe(pos)).toBe(0);
  });

  it("correct ROE calculation: upl/margin×100", () => {
    // margin = 500/10 = $50; upl = $5 → ROE = 10%
    const pos = makePos({ upl: 5, notional: 500, leverage: 10 });
    expect(computeRoe(pos)).toBeCloseTo(10);
  });

  it("with livePx uses computeLiveUpl", () => {
    const pos = makePos({ upl: 0, notional: 500, leverage: 10, size: 0.01, markPx: 50_000 });
    // price +1000 → delta=0.01*1000=10; margin=50; ROE=20%
    expect(computeRoe(pos, 51_000)).toBeCloseTo(20);
  });
});

// ─────────────────────────────────────────────────────────────
// computeTpProgress
// ─────────────────────────────────────────────────────────────

describe("computeTpProgress()", () => {
  it("no tp set → null", () => {
    expect(computeTpProgress(makePos({ tpTriggerPx: null }), 50_000)).toBeNull();
  });

  it("LONG at entry → 0%", () => {
    const pos = makePos({ entryPx: 50_000, tpTriggerPx: 55_000 });
    expect(computeTpProgress(pos, 50_000)).toBeCloseTo(0);
  });

  it("LONG at TP → 100%", () => {
    const pos = makePos({ entryPx: 50_000, tpTriggerPx: 55_000 });
    expect(computeTpProgress(pos, 55_000)).toBeCloseTo(100);
  });

  it("LONG halfway → 50%", () => {
    const pos = makePos({ entryPx: 50_000, tpTriggerPx: 55_000 });
    expect(computeTpProgress(pos, 52_500)).toBeCloseTo(50);
  });

  it("LONG beyond TP → clamped to 100%", () => {
    const pos = makePos({ entryPx: 50_000, tpTriggerPx: 55_000 });
    expect(computeTpProgress(pos, 60_000)).toBe(100);
  });

  it("LONG below entry → clamped to 0%", () => {
    const pos = makePos({ entryPx: 50_000, tpTriggerPx: 55_000 });
    expect(computeTpProgress(pos, 48_000)).toBe(0);
  });

  it("SHORT: price below entry → progress positive", () => {
    const pos = makePos({ direction: "SHORT", entryPx: 50_000, tpTriggerPx: 45_000 });
    expect(computeTpProgress(pos, 47_500)).toBeCloseTo(50);
  });
});

// ─────────────────────────────────────────────────────────────
// computeStopDistance
// ─────────────────────────────────────────────────────────────

describe("computeStopDistance()", () => {
  it("no stop → null", () => {
    expect(computeStopDistance(makePos({ slTriggerPx: null }), 50_000)).toBeNull();
  });

  it("LONG: stop 2% below → ~2%", () => {
    const pos = makePos({ slTriggerPx: 49_000 });
    // dist = (50000 - 49000) / 50000 * 100 = 2%
    expect(computeStopDistance(pos, 50_000)).toBeCloseTo(2.0);
  });

  it("SHORT: stop above px", () => {
    const pos = makePos({ direction: "SHORT", slTriggerPx: 51_000 });
    // dist = (51000 - 50000) / 50000 * 100 = 2%
    expect(computeStopDistance(pos, 50_000)).toBeCloseTo(2.0);
  });

  it("stop crossed → negative distance", () => {
    const pos = makePos({ slTriggerPx: 51_000 }); // LONG but stop ABOVE px
    expect(computeStopDistance(pos, 50_000)).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// categorizeHoldingDuration
// ─────────────────────────────────────────────────────────────

describe("categorizeHoldingDuration()", () => {
  const now = Date.now();
  const H = 3_600_000; // 1 hour in ms

  it("< 1 hour → lessThanHour", () => {
    const r = categorizeHoldingDuration(now - 30 * 60_000, now);
    expect(r.category).toBe("lessThanHour");
  });

  it("1-23 hours → hours", () => {
    const r = categorizeHoldingDuration(now - 5 * H, now);
    expect(r.category).toBe("hours");
    expect(r.hours).toBeCloseTo(5, 0);
  });

  it("24-47 hours → day", () => {
    const r = categorizeHoldingDuration(now - 30 * H, now);
    expect(r.category).toBe("day");
  });

  it("48-167 hours → days", () => {
    const r = categorizeHoldingDuration(now - 72 * H, now);
    expect(r.category).toBe("days");
  });

  it(">= 168 hours → week", () => {
    const r = categorizeHoldingDuration(now - 200 * H, now);
    expect(r.category).toBe("week");
  });
});
