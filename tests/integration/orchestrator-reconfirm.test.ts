/**
 * ORCHESTRATOR RECONFIRM TESTS — İkinci execution gate
 *
 * reconfirmSignal: 4 kontrol sırası —
 *   1. signal_stale   — sinyal MAX_SIGNAL_AGE_MS'dan eski
 *   2. price_drift    — livePrice referanstan >MAX_PRICE_DRIFT_PCT% sapma
 *   3. score_marginal — score threshold'a MIN_SCORE_MARGIN'dan yakın
 *   4. direction_flip — EMA50_4h yönü döndü
 *
 * Sıra önceliği: stale > drift > marginal > flip
 * Override parametreleri, null EMA (kontrol atlanır), diagnostics doğrulaması
 */

import { describe, it, expect } from "vitest";
import {
  reconfirmSignal,
  RECONFIRM_DEFAULTS,
  type ReconfirmInput,
} from "@/lib/orchestrator/reconfirm";
import type { ScoreResult } from "@/lib/score/orchestrator";
import type { BucketStats } from "@/lib/bucket/stats";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    pair: "BTC",
    score: 85,
    baseScore: 82,
    total: 85,
    verdict: "go",
    direction: "LONG",
    dirConfidence: 3,
    counterTrend: false,
    sub: { trend: 25, adx: 15, rsi: 10, vol: 15, bb: 8, vwap: 10, funding: 8, macro: 7 },
    reasons: {
      trend: "3-TF LONG",
      adx: "sweet spot",
      rsi: "50-60",
      vol: "≥1.5x",
      bb: "middle",
      vwap: "above ≤1σ",
      funding: "neutral",
      macro: "neutral",
    },
    blocks: [],
    softBlocks: [],
    sweepBonus: 2,
    regimeBonus: 3,
    regime: "trending_strong",
    goThreshold: 80,
    pullbackThreshold: 72,
    effectiveThreshold: 80,
    bucket: { min: 80, max: 90, n: 10, wr: 0.6, isCut: false, isBoost: true, hasData: true } as BucketStats,
    srModifier: 0,
    atrRegimeAdj: 0,
    volBreakoutActive: false,
    signalType: "classic",
    pullbackActive: false,
    overextFlags: 0,
    ...overrides,
  } as ScoreResult;
}

const BASE_NOW = 1_700_000_000_000;
const FRESH_TS = BASE_NOW - 30_000; // 30 saniye önce

function makeInput(overrides: Partial<ReconfirmInput> = {}): ReconfirmInput {
  return {
    signal: makeSignal(),
    signalTimestamp: FRESH_TS,
    signalReferencePx: 50000,
    livePrice: 50100,     // +0.2% — drift yok
    currentEma50_4h: 49000, // fiyat üstünde (LONG geçerli)
    now: BASE_NOW,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Başarılı geçiş
// ─────────────────────────────────────────────────────────────

describe("reconfirmSignal() — geçiş", () => {
  it("tüm şartlar sağlıklı → passed=true", () => {
    const r = reconfirmSignal(makeInput());
    expect(r.passed).toBe(true);
    expect(r.failReason).toBeNull();
    expect(r.reasonHuman).toContain("reconfirmed");
  });

  it("diagnostics doldurulmuş", () => {
    const r = reconfirmSignal(makeInput());
    expect(r.checks.ageMs).toBe(30_000);
    expect(r.checks.maxAgeMs).toBe(RECONFIRM_DEFAULTS.MAX_SIGNAL_AGE_MS);
    expect(r.checks.driftPct).toBeCloseTo(0.2, 1);
    expect(r.checks.directionFlipped).toBe(false);
  });

  it("EMA null → kontrol atlanır, directionFlipped=null", () => {
    const r = reconfirmSignal(makeInput({ currentEma50_4h: null }));
    expect(r.passed).toBe(true);
    expect(r.checks.directionFlipped).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 1. signal_stale
// ─────────────────────────────────────────────────────────────

describe("reconfirmSignal() — signal_stale", () => {
  it("sinyal tam 5dk eski → stale", () => {
    const r = reconfirmSignal(makeInput({
      signalTimestamp: BASE_NOW - RECONFIRM_DEFAULTS.MAX_SIGNAL_AGE_MS - 1,
    }));
    expect(r.passed).toBe(false);
    expect(r.failReason).toBe("signal_stale");
    expect(r.reasonHuman).toContain("stale");
  });

  it("sinyal tam 5dk eski (boundary = eşit) → geçer", () => {
    // ageMs = maxAgeMs → eşit → fail değil (> koşulu)
    const r = reconfirmSignal(makeInput({
      signalTimestamp: BASE_NOW - RECONFIRM_DEFAULTS.MAX_SIGNAL_AGE_MS,
    }));
    expect(r.passed).toBe(true);
  });

  it("maxSignalAgeMs override 60s → 61s eskide stale", () => {
    const r = reconfirmSignal(makeInput({
      signalTimestamp: BASE_NOW - 61_000,
      maxSignalAgeMs: 60_000,
    }));
    expect(r.failReason).toBe("signal_stale");
    expect(r.checks.maxAgeMs).toBe(60_000);
  });

  it("maxSignalAgeMs override 60s → 60s eskide geçer", () => {
    const r = reconfirmSignal(makeInput({
      signalTimestamp: BASE_NOW - 60_000,
      maxSignalAgeMs: 60_000,
    }));
    expect(r.passed).toBe(true);
  });

  it("stale kontrolü drift'ten önce gelir (stale+drift → stale kazanır)", () => {
    const r = reconfirmSignal(makeInput({
      signalTimestamp: BASE_NOW - 10 * 60_000, // çok eski
      livePrice: 60000, // %20 drift — her ikisi de fail eder
    }));
    expect(r.failReason).toBe("signal_stale"); // stale önce
  });
});

// ─────────────────────────────────────────────────────────────
// 2. price_drift
// ─────────────────────────────────────────────────────────────

describe("reconfirmSignal() — price_drift", () => {
  it(">0.5% drift → fail", () => {
    const r = reconfirmSignal(makeInput({ livePrice: 50251 })); // +0.502%
    expect(r.passed).toBe(false);
    expect(r.failReason).toBe("price_drift");
    expect(r.checks.driftPct).toBeGreaterThan(0.5);
  });

  it("tam 0.5% drift (boundary = eşit) → geçer", () => {
    const r = reconfirmSignal(makeInput({ livePrice: 50250 })); // +0.5%
    expect(r.passed).toBe(true);
  });

  it("aşağı drift de hesaplanır (abs)", () => {
    const r = reconfirmSignal(makeInput({ livePrice: 49748 })); // -0.504%
    expect(r.failReason).toBe("price_drift");
  });

  it("maxPriceDriftPct override 1.0% → 0.8% drift geçer", () => {
    const r = reconfirmSignal(makeInput({
      livePrice: 50400, // +0.8%
      maxPriceDriftPct: 1.0,
    }));
    expect(r.passed).toBe(true);
    expect(r.checks.maxDriftPct).toBe(1.0);
  });

  it("referans fiyat 0 → drift=0 (guard)", () => {
    const r = reconfirmSignal(makeInput({ signalReferencePx: 0 }));
    expect(r.checks.driftPct).toBe(0);
    expect(r.passed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. score_marginal
// ─────────────────────────────────────────────────────────────

describe("reconfirmSignal() — score_marginal", () => {
  it("total=81, threshold=80 → margin=1 < 2 → marginal", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ total: 81, effectiveThreshold: 80 }),
    }));
    expect(r.failReason).toBe("score_marginal");
    expect(r.checks.scoreMargin).toBe(1);
  });

  it("total=82, threshold=80 → margin=2 = min → geçer (boundary)", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ total: 82, effectiveThreshold: 80 }),
    }));
    expect(r.passed).toBe(true);
    expect(r.checks.scoreMargin).toBe(2);
  });

  it("minScoreMargin override=5 → margin=4 → fail", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ total: 84, effectiveThreshold: 80 }),
      minScoreMargin: 5,
    }));
    expect(r.failReason).toBe("score_marginal");
  });

  it("pullback sinyali — effectiveThreshold=72 ile margin hesabı", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({
        total: 74,
        goThreshold: 80,
        effectiveThreshold: 72, // pullback threshold aktif
        pullbackActive: true,
        signalType: "pullback",
      }),
    }));
    expect(r.checks.scoreMargin).toBe(2); // 74-72=2 = min → geçer
    expect(r.passed).toBe(true);
  });

  it("score_marginal drift'ten önce mi? Hayır — drift önce gelir", () => {
    // 1. stale yok, 2. drift var → drift kazanır
    const r = reconfirmSignal(makeInput({
      livePrice: 50260, // +0.52% drift
      signal: makeSignal({ total: 81, effectiveThreshold: 80 }), // marginal da var
    }));
    expect(r.failReason).toBe("price_drift");
  });
});

// ─────────────────────────────────────────────────────────────
// 4. direction_flip
// ─────────────────────────────────────────────────────────────

describe("reconfirmSignal() — direction_flip", () => {
  it("LONG sinyal + fiyat EMA altına düştü → flip", () => {
    const r = reconfirmSignal(makeInput({
      livePrice: 48000,       // EMA50_4h=49000'nin altında
      currentEma50_4h: 49000,
    }));
    expect(r.failReason).toBe("direction_flip");
    expect(r.checks.directionFlipped).toBe(true);
    expect(r.reasonHuman).toContain("LONG");
  });

  it("SHORT sinyal + fiyat EMA üstüne çıktı → flip", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ direction: "SHORT" }),
      livePrice: 51000,       // EMA50_4h=49000'nin üstünde
      currentEma50_4h: 49000,
    }));
    expect(r.failReason).toBe("direction_flip");
    expect(r.checks.directionFlipped).toBe(true);
  });

  it("LONG + fiyat EMA üstünde → flip yok", () => {
    const r = reconfirmSignal(makeInput({
      livePrice: 50100,       // EMA50_4h=49000 üstünde
      currentEma50_4h: 49000,
    }));
    expect(r.passed).toBe(true);
    expect(r.checks.directionFlipped).toBe(false);
  });

  it("SHORT + fiyat EMA altında → flip yok", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ direction: "SHORT" }),
      livePrice: 48000,
      currentEma50_4h: 49000,
    }));
    expect(r.passed).toBe(true);
    expect(r.checks.directionFlipped).toBe(false);
  });

  it("NEUTRAL sinyal + EMA var → flip tetiklenmez (NEUTRAL ne LONG ne SHORT)", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ direction: "NEUTRAL" }),
      livePrice: 48000,       // EMA altında
      currentEma50_4h: 49000,
    }));
    // NEUTRAL için wasLong=false wasShort=false → flip=false → passed
    expect(r.passed).toBe(true);
    expect(r.checks.directionFlipped).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Kontrol sırası (öncelik doğrulaması)
// ─────────────────────────────────────────────────────────────

describe("reconfirmSignal() — kontrol sırası", () => {
  it("stale + flip → stale önce raporlanır", () => {
    const r = reconfirmSignal(makeInput({
      signalTimestamp: BASE_NOW - 10 * 60_000,
      livePrice: 48000, // flip da tetikler
      currentEma50_4h: 49000,
    }));
    expect(r.failReason).toBe("signal_stale");
  });

  it("drift + marginal + flip → drift önce raporlanır", () => {
    const r = reconfirmSignal(makeInput({
      livePrice: 50260,   // +0.52% drift
      signal: makeSignal({ total: 81, effectiveThreshold: 80 }), // marginal
    }));
    expect(r.failReason).toBe("price_drift");
  });

  it("marginal + flip → marginal önce raporlanır", () => {
    const r = reconfirmSignal(makeInput({
      signal: makeSignal({ direction: "LONG", total: 81, effectiveThreshold: 80 }),
      livePrice: 48000,   // flip
      currentEma50_4h: 49000,
    }));
    expect(r.failReason).toBe("score_marginal");
  });
});
