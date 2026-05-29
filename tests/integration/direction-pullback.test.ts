/**
 * DIRECTION + PULLBACK TESTS
 *
 * inferDirection: 3-TF aligned (confidence=3), 4H+1H (confidence=2), NEUTRAL,
 *   ema200 teyidi, 15m yok fallback, eksik EMA fallback
 *
 * detectPullbackSetup: 8 şartın tümü sağlandı → active, her şart tek tek
 *   eksik → active=false+reason, NEUTRAL/SHORT, önkoşul eksik → sessiz çıkış,
 *   geometri var ama şart kaçtı → diagnostics dolu
 */

import { describe, it, expect } from "vitest";
import { inferDirection } from "@/lib/score/direction";
import {
  detectPullbackSetup,
  PULLBACK_CONSTANTS,
  type PullbackInput,
} from "@/lib/score/pullback";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** 8 1H kapanış — son bar ema'ya %0.5 yakın (pullback touch teyidi) */
function makeCloses1h(ema50: number, nearIdx = 7): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    // son bar ema'ya yakın, diğerleri uzak
    out.push(i === nearIdx ? ema50 * 1.004 : ema50 * 1.05);
  }
  return out;
}

/** 11 hacim — son 3 yüksek, önceki 8 düşük (canlanma) */
function makeVolumes1h(reviving = true): readonly number[] {
  const baseVol = 1000;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(baseVol);
  // son 3 bar
  for (let i = 0; i < 3; i++) out.push(reviving ? baseVol * 1.5 : baseVol * 0.5);
  return out;
}

const neutralSweep = { type: "none" as const, strength: 0, direction: "LONG" as const };

function makeFullPullbackInput(overrides: Partial<PullbackInput> = {}): PullbackInput {
  const ema50_1h = 50000;
  const ema21_1h = 49800;
  return {
    direction: "LONG",
    px4h: 51000,
    ema50_4h: 50000,
    ema50_1h,
    ema21_1h,
    closes1h: makeCloses1h(ema50_1h),
    volumes1h: makeVolumes1h(true),
    adx4h: 30,
    rsi1h: 45,
    sweep15m: neutralSweep,
    fg: 50,
    baseScore: 70,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// inferDirection
// ─────────────────────────────────────────────────────────────

describe("inferDirection()", () => {
  it("3-TF LONG → confidence 3", () => {
    const r = inferDirection({
      px15: 101,
      px1h: 101,
      px4h: 101,
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: 90,
      ema50_4h: 100,
    });
    expect(r.direction).toBe("LONG");
    expect(r.confidence).toBe(3);
  });

  it("3-TF SHORT → confidence 3", () => {
    const r = inferDirection({
      px15: 99,
      px1h: 99,
      px4h: 99,
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: 110,
      ema50_4h: 100,
    });
    expect(r.direction).toBe("SHORT");
    expect(r.confidence).toBe(3);
  });

  it("4H+1H LONG, 15m ters → confidence 2", () => {
    const r = inferDirection({
      px15: 99,     // 15m: fiyat EMA altında
      px1h: 101,
      px4h: 101,
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: 90,
      ema50_4h: 100,
    });
    expect(r.direction).toBe("LONG");
    expect(r.confidence).toBe(2);
  });

  it("4H+1H SHORT, 15m ters → confidence 2", () => {
    const r = inferDirection({
      px15: 101,
      px1h: 99,
      px4h: 99,
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: 110,
      ema50_4h: 100,
    });
    expect(r.direction).toBe("SHORT");
    expect(r.confidence).toBe(2);
  });

  it("4H+1H çelişki → NEUTRAL", () => {
    const r = inferDirection({
      px15: 101,
      px1h: 101,  // 1H LONG
      px4h: 99,   // 4H SHORT
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: 90,
      ema50_4h: 100,
    });
    expect(r.direction).toBe("NEUTRAL");
    expect(r.confidence).toBe(0);
  });

  it("1H EMA200 teyit başarısız: ema50_1h < ema200_1h → 3-TF LONG tetiklenmez", () => {
    // px1h > ema50_1h ama ema50_1h < ema200_1h → trend1hUp = false
    const r = inferDirection({
      px15: 101,
      px1h: 101,
      px4h: 101,
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: 110, // ema50 < ema200 → yapı teyidi yok
      ema50_4h: 100,
    });
    // 4H+1H: trend4hUp=true ama trend1hUp=false (ema200 engel) → NEUTRAL veya confidence 2 yok
    expect(r.direction).toBe("NEUTRAL");
  });

  it("15m null → 2-TF fallback LONG", () => {
    const r = inferDirection({
      px15: 99,   // 15m ters olur ama ema null
      px1h: 101,
      px4h: 101,
      ema21_15m: null,
      ema50_1h: 100,
      ema200_1h: null,
      ema50_4h: 100,
    });
    expect(r.direction).toBe("LONG");
    expect(r.confidence).toBe(2);
  });

  it("15m + 4H EMA null → NEUTRAL", () => {
    const r = inferDirection({
      px15: 101,
      px1h: 101,
      px4h: 101,
      ema21_15m: null,
      ema50_1h: null,
      ema200_1h: null,
      ema50_4h: null,
    });
    expect(r.direction).toBe("NEUTRAL");
    expect(r.confidence).toBe(0);
  });

  it("ema200_1h null → EMA200 teyidi atlanır (geçer)", () => {
    const r = inferDirection({
      px15: 101,
      px1h: 101,
      px4h: 101,
      ema21_15m: 100,
      ema50_1h: 100,
      ema200_1h: null, // null → teyit atlanır → kabul
      ema50_4h: 100,
    });
    expect(r.direction).toBe("LONG");
    expect(r.confidence).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────
// detectPullbackSetup — 8 şartın tümü sağlandı
// ─────────────────────────────────────────────────────────────

describe("detectPullbackSetup() — tam setup", () => {
  it("tüm 8 şart → active=true, signalType=pullback", () => {
    const r = detectPullbackSetup(makeFullPullbackInput());
    expect(r.active).toBe(true);
    expect(r.signalType).toBe("pullback");
    expect(r.reason).toContain("Pullback setup");
    expect(r.diagnostics?.trend4hOK).toBe(true);
    expect(r.diagnostics?.adx4hOK).toBe(true);
    expect(r.diagnostics?.pullbackTouch).toBe(true);
    expect(r.diagnostics?.rsiOK).toBe(true);
    expect(r.diagnostics?.volReviving).toBe(true);
    expect(r.diagnostics?.sweepAgainst).toBe(false);
    expect(r.diagnostics?.fgOK).toBe(true);
    expect(r.diagnostics?.baseOK).toBe(true);
  });

  it("SHORT setup — px4h < ema50_4h", () => {
    const ema50_1h = 50000;
    const r = detectPullbackSetup({
      direction: "SHORT",
      px4h: 49000,
      ema50_4h: 50000,
      ema50_1h,
      ema21_1h: 50100,
      closes1h: makeCloses1h(ema50_1h),
      volumes1h: makeVolumes1h(true),
      adx4h: 30,
      rsi1h: 55, // SHORT cool-down: 48-62
      sweep15m: neutralSweep,
      fg: 50,
      baseScore: 70,
    });
    expect(r.active).toBe(true);
    expect(r.signalType).toBe("pullback");
  });
});

// ─────────────────────────────────────────────────────────────
// Her şart tek tek eksik
// ─────────────────────────────────────────────────────────────

describe("detectPullbackSetup() — şart eksikleri", () => {
  it("4H trend yok (px4h < ema50_4h LONG) → active=false, reason=null (geometri yok)", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ px4h: 49000 }));
    expect(r.active).toBe(false);
    // trend4hOK false → geometri yok → reason=null
    expect(r.reason).toBeNull();
  });

  it("ADX < 22 → active=false", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ adx4h: 20 }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.adx4hOK).toBe(false);
  });

  it("ADX boundary = 22 → adx4hOK=true", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ adx4h: PULLBACK_CONSTANTS.ADX_MIN }));
    expect(r.diagnostics?.adx4hOK).toBe(true);
  });

  it("closes1h EMA'ya hiç yaklaşmamış → pullbackTouch=false", () => {
    const farCloses = new Array(8).fill(55000); // ema50_1h=50000'den çok uzak
    const r = detectPullbackSetup(makeFullPullbackInput({ closes1h: farCloses }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.pullbackTouch).toBe(false);
  });

  it("LONG RSI > 52 → rsiOK=false", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ rsi1h: 53 }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.rsiOK).toBe(false);
    expect(r.reason).toContain("RSI");
  });

  it("LONG RSI = 38 → rsiOK=true (boundary)", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ rsi1h: PULLBACK_CONSTANTS.RSI_LONG_MIN }));
    expect(r.diagnostics?.rsiOK).toBe(true);
  });

  it("LONG RSI = 52 → rsiOK=true (boundary)", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ rsi1h: PULLBACK_CONSTANTS.RSI_LONG_MAX }));
    expect(r.diagnostics?.rsiOK).toBe(true);
  });

  it("hacim sönük → volReviving=false, reason içeriyor", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ volumes1h: makeVolumes1h(false) }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.volReviving).toBe(false);
    expect(r.reason).toContain("hacim");
  });

  it("ters bearish sweep LONG → sweepAgainst=true, active=false", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({
      sweep15m: { type: "bearish_sweep", strength: 0.8, direction: "SHORT" as const },
    }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.sweepAgainst).toBe(true);
    expect(r.reason).toContain("ters sweep");
  });

  it("bullish sweep SHORT ters yön → sweepAgainst=true", () => {
    const ema50_1h = 50000;
    const r = detectPullbackSetup({
      direction: "SHORT",
      px4h: 49000,
      ema50_4h: 50000,
      ema50_1h,
      ema21_1h: 50100,
      closes1h: makeCloses1h(ema50_1h),
      volumes1h: makeVolumes1h(true),
      adx4h: 30,
      rsi1h: 55,
      sweep15m: { type: "bullish_sweep", strength: 0.8, direction: "LONG" as const },
      fg: 50,
      baseScore: 70,
    });
    expect(r.diagnostics?.sweepAgainst).toBe(true);
    expect(r.active).toBe(false);
  });

  it("F&G < 25 → fgOK=false", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ fg: 20 }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.fgOK).toBe(false);
    expect(r.reason).toContain("F&G");
  });

  it("F&G = 25 → fgOK=true (boundary)", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ fg: PULLBACK_CONSTANTS.FG_MIN }));
    expect(r.diagnostics?.fgOK).toBe(true);
  });

  it("baseScore < 65 → baseOK=false", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ baseScore: 64 }));
    expect(r.active).toBe(false);
    expect(r.diagnostics?.baseOK).toBe(false);
    expect(r.reason).toContain("baseScore");
  });

  it("baseScore = 65 → baseOK=true (boundary)", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ baseScore: PULLBACK_CONSTANTS.BASE_SCORE_MIN }));
    expect(r.diagnostics?.baseOK).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Önkoşul eksik → sessiz çıkış (reason=null)
// ─────────────────────────────────────────────────────────────

describe("detectPullbackSetup() — önkoşul eksik sessiz çıkış", () => {
  it("NEUTRAL direction → active=false, reason=null", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ direction: "NEUTRAL" }));
    expect(r.active).toBe(false);
    expect(r.signalType).toBe("classic");
    expect(r.reason).toBeNull();
  });

  it("ema50_4h null → sessiz çıkış", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ ema50_4h: null }));
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("adx4h null → sessiz çıkış", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ adx4h: null }));
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("rsi1h null → sessiz çıkış", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ rsi1h: null }));
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("closes1h yetersiz (< 8 bar) → sessiz çıkış", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ closes1h: [50000, 50000, 50000] }));
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("closes1h boş → sessiz çıkış", () => {
    const r = detectPullbackSetup(makeFullPullbackInput({ closes1h: [] }));
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
  });
});
