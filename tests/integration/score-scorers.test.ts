/**
 * SCORE SCORERS — 8 kategori + 2 bonus tam kapsama.
 *
 * scoreTrend, scoreAdx, scoreRsi, scoreVolume, scoreBb, scoreVwap,
 * scoreFunding, scoreMacro, scoreSweepBonus, scoreRegimeBonus
 */

import { describe, it, expect } from "vitest";
import {
  scoreTrend,
  scoreAdx,
  scoreRsi,
  scoreVolume,
  scoreBb,
  scoreVwap,
  scoreFunding,
  scoreMacro,
  scoreSweepBonus,
  scoreRegimeBonus,
} from "@/lib/score/scorers";

// ─────────────────────────────────────────────────────────────
// A) scoreTrend (25 pts)
// ─────────────────────────────────────────────────────────────

describe("scoreTrend()", () => {
  it("dirConfidence=3 → 25 pts", () => {
    const r = scoreTrend("LONG", 3, 50000, null);
    expect(r.score).toBe(25);
    expect(r.counterTrend).toBe(false);
  });

  it("dirConfidence=2 → 18 pts", () => {
    expect(scoreTrend("LONG", 2, 50000, null).score).toBe(18);
  });

  it("dirConfidence=1, NEUTRAL → 0 pts", () => {
    expect(scoreTrend("NEUTRAL", 1, 50000, null).score).toBe(0);
  });

  it("LONG above EMA200 → not counter-trend", () => {
    const r = scoreTrend("LONG", 3, 50000, 45000); // px > ema200
    expect(r.counterTrend).toBe(false);
    expect(r.reason).toContain("uyumlu");
  });

  it("LONG below EMA200 → counterTrend=true", () => {
    const r = scoreTrend("LONG", 3, 40000, 45000); // px < ema200
    expect(r.counterTrend).toBe(true);
    expect(r.reason).toContain("counter-trend");
  });

  it("SHORT above EMA200 → counterTrend=true", () => {
    const r = scoreTrend("SHORT", 3, 50000, 45000); // px > ema200, short
    expect(r.counterTrend).toBe(true);
  });

  it("SHORT below EMA200 → not counter-trend", () => {
    const r = scoreTrend("SHORT", 3, 40000, 45000);
    expect(r.counterTrend).toBe(false);
  });

  it("ema200=null → no counter-trend check", () => {
    const r = scoreTrend("LONG", 3, 50000, null);
    expect(r.counterTrend).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// B) scoreAdx (15 pts)
// ─────────────────────────────────────────────────────────────

describe("scoreAdx()", () => {
  it("null → 0", () => expect(scoreAdx(null).score).toBe(0));

  it("ADX 25-40 → 15 pts (sweet spot)", () => {
    expect(scoreAdx(25).score).toBe(15);
    expect(scoreAdx(32).score).toBe(15);
    expect(scoreAdx(40).score).toBe(15);
  });

  it("ADX 20-24 → 9 pts (developing)", () => {
    expect(scoreAdx(20).score).toBe(9);
    expect(scoreAdx(24).score).toBe(9);
  });

  it("ADX < 20 → 0 pts (range)", () => {
    expect(scoreAdx(15).score).toBe(0);
    expect(scoreAdx(19).score).toBe(0);
  });

  it("ADX 41-50 → 0 pts (tired)", () => {
    expect(scoreAdx(45).score).toBe(0);
  });

  it("ADX > 50 → 0 pts (exhausted)", () => {
    expect(scoreAdx(55).score).toBe(0);
  });

  it("boundary: ADX exactly 25 → 15", () => expect(scoreAdx(25).score).toBe(15));
  it("boundary: ADX exactly 40 → 15", () => expect(scoreAdx(40).score).toBe(15));
  it("boundary: ADX exactly 41 → 0", () => expect(scoreAdx(41).score).toBe(0));
});

// ─────────────────────────────────────────────────────────────
// C) scoreRsi (10 pts, direction-aware)
// ─────────────────────────────────────────────────────────────

describe("scoreRsi()", () => {
  it("null → 0", () => expect(scoreRsi(null, "LONG").score).toBe(0));

  // LONG tiers
  it("LONG RSI 50-60 → 10 pts", () => {
    expect(scoreRsi(50, "LONG").score).toBe(10);
    expect(scoreRsi(60, "LONG").score).toBe(10);
  });
  it("LONG RSI 61-65 → 7 pts", () => {
    expect(scoreRsi(61, "LONG").score).toBe(7);
    expect(scoreRsi(65, "LONG").score).toBe(7);
  });
  it("LONG RSI 45-49 → 6 pts", () => {
    expect(scoreRsi(45, "LONG").score).toBe(6);
    expect(scoreRsi(49, "LONG").score).toBe(6);
  });
  it("LONG RSI 66-70 → 3 pts", () => {
    expect(scoreRsi(66, "LONG").score).toBe(3);
    expect(scoreRsi(70, "LONG").score).toBe(3);
  });
  it("LONG RSI > 70 → 0 pts (overbought)", () => {
    expect(scoreRsi(71, "LONG").score).toBe(0);
    expect(scoreRsi(85, "LONG").score).toBe(0);
  });
  it("LONG RSI 35-44 → 4 pts (weak)", () => {
    expect(scoreRsi(35, "LONG").score).toBe(4);
    expect(scoreRsi(44, "LONG").score).toBe(4);
  });
  it("LONG RSI < 35 → 0 pts (conflict)", () => {
    expect(scoreRsi(20, "LONG").score).toBe(0);
  });

  // SHORT tiers
  it("SHORT RSI 40-50 → 10 pts", () => {
    expect(scoreRsi(40, "SHORT").score).toBe(10);
    expect(scoreRsi(50, "SHORT").score).toBe(10);
  });
  it("SHORT RSI 35-39 → 7 pts", () => {
    expect(scoreRsi(35, "SHORT").score).toBe(7);
    expect(scoreRsi(39, "SHORT").score).toBe(7);
  });
  it("SHORT RSI 51-55 → 6 pts", () => {
    expect(scoreRsi(51, "SHORT").score).toBe(6);
    expect(scoreRsi(55, "SHORT").score).toBe(6);
  });
  it("SHORT RSI 30-34 → 3 pts", () => {
    expect(scoreRsi(30, "SHORT").score).toBe(3);
    expect(scoreRsi(34, "SHORT").score).toBe(3);
  });
  it("SHORT RSI < 30 → 0 pts (oversold)", () => {
    expect(scoreRsi(29, "SHORT").score).toBe(0);
  });
  it("SHORT RSI 56-65 → 4 pts (weak)", () => {
    expect(scoreRsi(56, "SHORT").score).toBe(4);
    expect(scoreRsi(65, "SHORT").score).toBe(4);
  });
  it("SHORT RSI > 65 → 0 pts (conflict)", () => {
    expect(scoreRsi(80, "SHORT").score).toBe(0);
  });

  it("NEUTRAL → 0 pts", () => {
    expect(scoreRsi(55, "NEUTRAL").score).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// D) scoreVolume (15 pts)
// ─────────────────────────────────────────────────────────────

describe("scoreVolume()", () => {
  it("null → 0", () => expect(scoreVolume(null).score).toBe(0));
  it("≥ 1.5x → 15 pts (strong)", () => {
    expect(scoreVolume(1.5).score).toBe(15);
    expect(scoreVolume(3.0).score).toBe(15);
  });
  it("1.0-1.49x → 10 pts (healthy)", () => {
    expect(scoreVolume(1.0).score).toBe(10);
    expect(scoreVolume(1.49).score).toBe(10);
  });
  it("0.7-0.99x → 3 pts (low)", () => {
    expect(scoreVolume(0.7).score).toBe(3);
    expect(scoreVolume(0.99).score).toBe(3);
  });
  it("< 0.7x → 0 pts (very low)", () => {
    expect(scoreVolume(0.5).score).toBe(0);
    expect(scoreVolume(0.69).score).toBe(0);
  });
  it("boundary: exactly 1.0 → 10", () => expect(scoreVolume(1.0).score).toBe(10));
  it("boundary: exactly 1.5 → 15", () => expect(scoreVolume(1.5).score).toBe(15));
});

// ─────────────────────────────────────────────────────────────
// E) scoreBb (10 pts, direction-aware)
// ─────────────────────────────────────────────────────────────

describe("scoreBb()", () => {
  it("null → 0", () => expect(scoreBb(null, "LONG").score).toBe(0));

  it("0.35-0.65 → 10 pts (middle band, any dir)", () => {
    expect(scoreBb(0.5, "LONG").score).toBe(10);
    expect(scoreBb(0.5, "SHORT").score).toBe(10);
    expect(scoreBb(0.35, "LONG").score).toBe(10);
    expect(scoreBb(0.65, "SHORT").score).toBe(10);
  });

  it("LONG: 0.15-0.34 → 8 pts (lower-mid, good for LONG)", () => {
    expect(scoreBb(0.25, "LONG").score).toBe(8);
  });

  it("SHORT: 0.66-0.85 → 8 pts (upper-mid, good for SHORT)", () => {
    expect(scoreBb(0.75, "SHORT").score).toBe(8);
  });

  it("LONG: 0.66-0.80 → 4 pts (upper-mid, late)", () => {
    expect(scoreBb(0.70, "LONG").score).toBe(4);
  });

  it("SHORT: 0.20-0.34 → 4 pts (lower-mid, late)", () => {
    expect(scoreBb(0.25, "SHORT").score).toBe(4);
  });

  it("LONG: 0.81-0.96 → 0 pts (near upper band)", () => {
    expect(scoreBb(0.9, "LONG").score).toBe(0);
  });

  it("SHORT: 0.04-0.19 → 0 pts (near lower band)", () => {
    expect(scoreBb(0.1, "SHORT").score).toBe(0);
  });

  it("band outside (>0.97 or <0.03) → 0 pts", () => {
    expect(scoreBb(0.99, "LONG").score).toBe(0);
    expect(scoreBb(0.01, "SHORT").score).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// F) scoreVwap (10 pts)
// ─────────────────────────────────────────────────────────────

describe("scoreVwap()", () => {
  const vwap = { vwap: 50000, stddev: 1000 };

  it("null → 0", () => expect(scoreVwap(null, 50000, "LONG").score).toBe(0));

  it("LONG above VWAP ≤ 1σ → 10 pts", () => {
    expect(scoreVwap(vwap, 50500, "LONG").score).toBe(10);   // 0.5σ
    expect(scoreVwap(vwap, 51000, "LONG").score).toBe(10);   // 1.0σ
  });

  it("LONG above VWAP 1.0-1.3σ → 5 pts", () => {
    expect(scoreVwap(vwap, 51200, "LONG").score).toBe(5);    // 1.2σ
  });

  it("LONG above VWAP >1.3σ → 0 pts (too far)", () => {
    expect(scoreVwap(vwap, 51500, "LONG").score).toBe(0);    // 1.5σ
  });

  it("LONG below VWAP → 0 pts (conflict)", () => {
    expect(scoreVwap(vwap, 49000, "LONG").score).toBe(0);
  });

  it("SHORT below VWAP ≤ 1σ → 10 pts", () => {
    expect(scoreVwap(vwap, 49500, "SHORT").score).toBe(10);
  });

  it("SHORT above VWAP → 0 pts (conflict)", () => {
    expect(scoreVwap(vwap, 51000, "SHORT").score).toBe(0);
  });

  it("NEUTRAL → 0 pts", () => {
    expect(scoreVwap(vwap, 51000, "NEUTRAL").score).toBe(0);
  });

  it("stddev=0 → distSigma=0 → 10 pts if above for LONG", () => {
    expect(scoreVwap({ vwap: 50000, stddev: 0 }, 51000, "LONG").score).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
// G) scoreFunding (8 pts, contrarian)
// ─────────────────────────────────────────────────────────────

describe("scoreFunding()", () => {
  it("null → 0", () => expect(scoreFunding(null, "LONG").score).toBe(0));

  it("|fr| ≤ 0.02% → 8 pts (neutral, both dirs)", () => {
    expect(scoreFunding(0.0001, "LONG").score).toBe(8);  // 0.01%
    expect(scoreFunding(-0.0001, "SHORT").score).toBe(8);
  });

  it("LONG + fr < -0.02% → 8 pts (contrarian opportunity)", () => {
    expect(scoreFunding(-0.0005, "LONG").score).toBe(8); // -0.05%
  });

  it("SHORT + fr > 0.04% → 8 pts (contrarian opportunity)", () => {
    expect(scoreFunding(0.0006, "SHORT").score).toBe(8); // +0.06%
  });

  it("LONG + fr > 0.04% → 1 pt (crowded longs)", () => {
    expect(scoreFunding(0.0006, "LONG").score).toBe(1);  // +0.06%
  });

  it("SHORT + fr < -0.03% → 1 pt (crowded shorts)", () => {
    expect(scoreFunding(-0.0004, "SHORT").score).toBe(1); // -0.04%
  });

  it("moderate fr not hitting extremes → 5 pts (neutral)", () => {
    // fr = 0.03% → absFr=0.03, not ≤0.02, not LONG<-0.02, not SHORT>0.04
    // not LONG>0.04, not SHORT<-0.03 → 5 pts
    expect(scoreFunding(0.0003, "LONG").score).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// H) scoreMacro (7 pts)
// ─────────────────────────────────────────────────────────────

describe("scoreMacro()", () => {
  it("F&G 30-60 → 7 pts (healthy, any dir)", () => {
    expect(scoreMacro(50, "LONG").score).toBe(7);
    expect(scoreMacro(30, "SHORT").score).toBe(7);
    expect(scoreMacro(60, "LONG").score).toBe(7);
  });

  it("F&G < 20 + LONG → 5 pts (extreme fear favors LONG)", () => {
    expect(scoreMacro(10, "LONG").score).toBe(5);
  });

  it("F&G < 20 + SHORT → 2 pts (fear bad for SHORT)", () => {
    expect(scoreMacro(10, "SHORT").score).toBe(2);
  });

  it("F&G > 80 + SHORT → 5 pts (extreme greed favors SHORT)", () => {
    expect(scoreMacro(90, "SHORT").score).toBe(5);
  });

  it("F&G > 80 + LONG → 2 pts (greed bad for LONG)", () => {
    expect(scoreMacro(90, "LONG").score).toBe(2);
  });

  it("F&G 20-29 → 4 pts (fear)", () => {
    expect(scoreMacro(25, "LONG").score).toBe(4);
  });

  it("F&G 61-80 → 4 pts (greedy)", () => {
    expect(scoreMacro(70, "LONG").score).toBe(4);
  });

  it("boundary: F&G exactly 30 → 7", () => expect(scoreMacro(30, "LONG").score).toBe(7));
  it("boundary: F&G exactly 60 → 7", () => expect(scoreMacro(60, "LONG").score).toBe(7));
});

// ─────────────────────────────────────────────────────────────
// BONUS 1: scoreSweepBonus
// ─────────────────────────────────────────────────────────────

describe("scoreSweepBonus()", () => {
  it("no sweep → 0 bonus, not counted", () => {
    const r = scoreSweepBonus({ type: null, strength: 0.8 }, "LONG", 80);
    expect(r.bonus).toBe(0);
    expect(r.counted).toBe(false);
  });

  it("sweep aligned + strength≥0.5 + baseScore≥75 → bonus counted", () => {
    const r = scoreSweepBonus({ type: "bullish_sweep", strength: 0.8 }, "LONG", 80);
    expect(r.bonus).toBe(Math.round(3 * 0.8));
    expect(r.counted).toBe(true);
  });

  it("bonus = round(3 × strength)", () => {
    expect(scoreSweepBonus({ type: "bullish_sweep", strength: 1.0 }, "LONG", 80).bonus).toBe(3);
    expect(scoreSweepBonus({ type: "bullish_sweep", strength: 0.5 }, "LONG", 80).bonus).toBe(2);
  });

  it("baseScore < 75 → not counted, reason mentions score", () => {
    const r = scoreSweepBonus({ type: "bullish_sweep", strength: 0.8 }, "LONG", 74);
    expect(r.bonus).toBe(0);
    expect(r.counted).toBe(false);
    expect(r.reason).toContain("74");
  });

  it("strength < 0.5 → not counted, reason mentions strength", () => {
    const r = scoreSweepBonus({ type: "bullish_sweep", strength: 0.4 }, "LONG", 80);
    expect(r.bonus).toBe(0);
    expect(r.counted).toBe(false);
    expect(r.reason).toContain("0.40");
  });

  it("sweep direction mismatch → 0 bonus, no reason", () => {
    // bearish sweep but LONG signal
    const r = scoreSweepBonus({ type: "bearish_sweep", strength: 0.9 }, "LONG", 80);
    expect(r.bonus).toBe(0);
    expect(r.reason).toBeNull();
  });

  it("SHORT + bearish_sweep + conditions met → bonus", () => {
    const r = scoreSweepBonus({ type: "bearish_sweep", strength: 0.9 }, "SHORT", 80);
    expect(r.counted).toBe(true);
    expect(r.bonus).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// BONUS 2: scoreRegimeBonus
// ─────────────────────────────────────────────────────────────

describe("scoreRegimeBonus()", () => {
  const base = {
    adx: 35,
    dirConfidence: 3,
    counterTrend: false,
    bbPct: 0.5,
    baseScore: 80,
    direction: "LONG" as const,
  };

  it("adx=null → unknown regime, 0 bonus", () => {
    const r = scoreRegimeBonus({ ...base, adx: null });
    expect(r.regime).toBe("unknown");
    expect(r.bonus).toBe(0);
  });

  it("NEUTRAL direction → unknown, 0 bonus", () => {
    const r = scoreRegimeBonus({ ...base, direction: "NEUTRAL" });
    expect(r.regime).toBe("unknown");
    expect(r.bonus).toBe(0);
  });

  it("baseScore < 75 → unknown, 0 bonus", () => {
    const r = scoreRegimeBonus({ ...base, baseScore: 74 });
    expect(r.regime).toBe("unknown");
    expect(r.bonus).toBe(0);
  });

  it("adx≥30 + dirConf=3 + no counterTrend → trending_strong, +3", () => {
    const r = scoreRegimeBonus(base);
    expect(r.regime).toBe("trending_strong");
    expect(r.bonus).toBe(3);
  });

  it("trending_strong requires no counterTrend", () => {
    const r = scoreRegimeBonus({ ...base, counterTrend: true });
    expect(r.regime).not.toBe("trending_strong");
  });

  it("adx 20-29, dirConf≥2, no counterTrend → trending_weak, +1", () => {
    const r = scoreRegimeBonus({ ...base, adx: 25, dirConfidence: 2 });
    expect(r.regime).toBe("trending_weak");
    expect(r.bonus).toBe(1);
  });

  it("adx < 20 + LONG + bbPct ≤ 0.25 → ranging_meanrev, +2", () => {
    const r = scoreRegimeBonus({ ...base, adx: 15, bbPct: 0.2 });
    expect(r.regime).toBe("ranging_meanrev");
    expect(r.bonus).toBe(2);
  });

  it("adx < 20 + SHORT + bbPct ≥ 0.75 → ranging_meanrev, +2", () => {
    const r = scoreRegimeBonus({ ...base, adx: 15, direction: "SHORT", bbPct: 0.8 });
    expect(r.regime).toBe("ranging_meanrev");
    expect(r.bonus).toBe(2);
  });

  it("adx < 20 + bbPct in middle → ranging, 0 bonus", () => {
    const r = scoreRegimeBonus({ ...base, adx: 15, bbPct: 0.5 });
    expect(r.regime).toBe("ranging");
    expect(r.bonus).toBe(0);
  });

  it("adx 20-24, dirConf < 2 → transitioning, 0 bonus", () => {
    const r = scoreRegimeBonus({ ...base, adx: 22, dirConfidence: 1 });
    expect(r.regime).toBe("transitioning");
    expect(r.bonus).toBe(0);
  });

  it("mixed regime → 0 bonus", () => {
    // adx 25-29, dirConf=3, no counterTrend → trending_weak (not mixed)
    // For mixed: counterTrend=true + adx>=25 → falls through to mixed
    const r = scoreRegimeBonus({ ...base, adx: 26, dirConfidence: 3, counterTrend: true });
    expect(r.bonus).toBe(0);
  });
});
