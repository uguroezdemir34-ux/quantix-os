/**
 * FEE & SPREAD MODEL — Entegrasyon Testleri
 *
 * 1. assessSpread — normal / elevated / wide koşulları
 * 2. calibrateTpForFee — LONG / SHORT fee amortismanı
 * 3. buildFeeSpreadDecision — birleşik karar
 * 4. computePositionSize entegrasyonu — orderMode + feeAdjustedTp
 */

import { describe, it, expect } from "vitest";
import {
  assessSpread,
  calibrateTpForFee,
  buildFeeSpreadDecision,
  defaultFeeContext,
  SPREAD_ELEVATED_MULTIPLIER,
  SPREAD_WIDE_MULTIPLIER,
  DEFAULT_TAKER_FEE,
  DEFAULT_MAKER_FEE,
  MIN_FEE_LOAD_FOR_CALIBRATION,
  type SpreadContext,
  type FillFeeContext,
} from "@/lib/sizer/fee-spread-model";
import { computePositionSize } from "@/lib/sizer/position";
import type { PositionSizerInput } from "@/lib/sizer/types";

// ─── Yardımcı fonksiyonlar ───────────────────────────────────

function makeInput(overrides: Partial<PositionSizerInput> = {}): PositionSizerInput {
  return {
    pair: "BTC",
    direction: "LONG",
    px: 60000,
    atr: 1200,
    adx1h: 30,
    swingLow: 58000,
    swingHigh: 62000,
    balance: { total: 1000, free: 800 },
    drawdownProtocol: { tier: "normal", multiplier: 1, label: "Normal" },
    bucket: { n: 10, wr: 65, isCut: false, isBoost: false, hasData: true, min: 70, max: 89 },
    score: 75,
    ...overrides,
  };
}

// ─── assessSpread ────────────────────────────────────────────

describe("assessSpread", () => {
  it("normalSpread=0 → normal + market (güvenli fallback)", () => {
    const r = assessSpread({ currentSpread: 50, normalSpread: 0 });
    expect(r.condition).toBe("normal");
    expect(r.orderMode).toBe("market");
    expect(r.spreadRatio).toBe(1);
  });

  it("eşit spread → ratio=1 → normal + market", () => {
    const r = assessSpread({ currentSpread: 10, normalSpread: 10 });
    expect(r.condition).toBe("normal");
    expect(r.orderMode).toBe("market");
    expect(r.spreadRatio).toBeCloseTo(1);
  });

  it(`ratio < ${SPREAD_ELEVATED_MULTIPLIER} → normal + market`, () => {
    const r = assessSpread({ currentSpread: 12, normalSpread: 10 });
    expect(r.condition).toBe("normal");
    expect(r.orderMode).toBe("market");
  });

  it(`ratio = ${SPREAD_ELEVATED_MULTIPLIER} → elevated + limit`, () => {
    const r = assessSpread({
      currentSpread: 10 * SPREAD_ELEVATED_MULTIPLIER,
      normalSpread: 10,
    });
    expect(r.condition).toBe("elevated");
    expect(r.orderMode).toBe("limit");
  });

  it("ratio arasında (elevated) → limit", () => {
    const r = assessSpread({ currentSpread: 20, normalSpread: 10 }); // ratio=2
    expect(r.condition).toBe("elevated");
    expect(r.orderMode).toBe("limit");
    expect(r.spreadRatio).toBe(2);
  });

  it(`ratio ≥ ${SPREAD_WIDE_MULTIPLIER} → wide + limit`, () => {
    const r = assessSpread({ currentSpread: 35, normalSpread: 10 });
    expect(r.condition).toBe("wide");
    expect(r.orderMode).toBe("limit");
  });

  it("çok geniş spread (10×) → wide + limit", () => {
    const r = assessSpread({ currentSpread: 100, normalSpread: 10 });
    expect(r.condition).toBe("wide");
    expect(r.orderMode).toBe("limit");
    expect(r.spreadRatio).toBe(10);
  });
});

// ─── calibrateTpForFee ───────────────────────────────────────

describe("calibrateTpForFee — LONG", () => {
  const feeCtx: FillFeeContext = {
    takerFeeRate: DEFAULT_TAKER_FEE,
    makerFeeRate: DEFAULT_MAKER_FEE,
  };
  const px = 60000;
  const tp1 = 61800;
  const tp2 = 63600;

  it("market modunda taker fee kullanır", () => {
    const r = calibrateTpForFee("LONG", px, tp1, tp2, feeCtx, "market");
    const expectedLoad = 2 * DEFAULT_TAKER_FEE;
    expect(r.totalFeeLoad).toBeCloseTo(expectedLoad);
    expect(r.calibrated).toBe(true);
    expect(r.adjustedTp1).toBeCloseTo(tp1 + expectedLoad * px);
    expect(r.adjustedTp2).toBeCloseTo(tp2 + expectedLoad * px);
  });

  it("limit modunda maker fee kullanır (daha az offset)", () => {
    const rMarket = calibrateTpForFee("LONG", px, tp1, tp2, feeCtx, "market");
    const rLimit = calibrateTpForFee("LONG", px, tp1, tp2, feeCtx, "limit");
    // Maker fee < taker fee → limit modunda daha az offset
    expect(rLimit.adjustedTp1).toBeLessThan(rMarket.adjustedTp1);
    expect(rLimit.totalFeeLoad).toBeCloseTo(2 * DEFAULT_MAKER_FEE);
  });

  it("lastFillFeeRate önceliklidir", () => {
    const customFee = 0.001; // %0.1 (yüksek)
    const r = calibrateTpForFee(
      "LONG", px, tp1, tp2,
      { ...feeCtx, lastFillFeeRate: customFee },
      "market",
    );
    expect(r.totalFeeLoad).toBeCloseTo(2 * customFee);
    expect(r.adjustedTp1).toBeCloseTo(tp1 + 2 * customFee * px);
  });

  it("adjustedTp > originalTp (LONG için TP yukarı kayar)", () => {
    const r = calibrateTpForFee("LONG", px, tp1, tp2, feeCtx, "market");
    expect(r.adjustedTp1).toBeGreaterThan(r.originalTp1);
    expect(r.adjustedTp2).toBeGreaterThan(r.originalTp2);
  });

  it("orijinal değerler bozulmaz", () => {
    const r = calibrateTpForFee("LONG", px, tp1, tp2, feeCtx, "market");
    expect(r.originalTp1).toBe(tp1);
    expect(r.originalTp2).toBe(tp2);
  });
});

describe("calibrateTpForFee — SHORT", () => {
  const feeCtx = defaultFeeContext();
  const px = 60000;
  const tp1 = 58200; // SHORT için TP aşağıda
  const tp2 = 56400;

  it("SHORT için adjustedTp < originalTp (TP aşağı kayar)", () => {
    const r = calibrateTpForFee("SHORT", px, tp1, tp2, feeCtx, "market");
    expect(r.adjustedTp1).toBeLessThan(r.originalTp1);
    expect(r.adjustedTp2).toBeLessThan(r.originalTp2);
  });

  it("fee yükü simetrik (direction bağımsız)", () => {
    const rLong = calibrateTpForFee("LONG", px, 61800, 63600, feeCtx, "market");
    const rShort = calibrateTpForFee("SHORT", px, tp1, tp2, feeCtx, "market");
    expect(rLong.totalFeeLoad).toBeCloseTo(rShort.totalFeeLoad);
  });
});

describe("calibrateTpForFee — eşik altı", () => {
  it(`fee yükü < ${MIN_FEE_LOAD_FOR_CALIBRATION} → calibrated=false, TP değişmez`, () => {
    const tinyFee: FillFeeContext = {
      takerFeeRate: 0.0001, // %0.01 — 2×=0.0002 < 0.0003 eşik
      makerFeeRate: 0.00005,
    };
    const r = calibrateTpForFee("LONG", 60000, 61800, 63600, tinyFee, "market");
    expect(r.calibrated).toBe(false);
    expect(r.adjustedTp1).toBe(r.originalTp1);
    expect(r.adjustedTp2).toBe(r.originalTp2);
  });
});

// ─── buildFeeSpreadDecision ──────────────────────────────────

describe("buildFeeSpreadDecision", () => {
  const spreadCtx: SpreadContext = { currentSpread: 10, normalSpread: 10 };
  const feeCtx = defaultFeeContext();
  const px = 60000;

  it("normal spread → market", () => {
    const d = buildFeeSpreadDecision("LONG", px, 61800, 63600, spreadCtx, feeCtx);
    expect(d.orderMode).toBe("market");
    expect(d.spread.condition).toBe("normal");
  });

  it("elevated spread → limit + fee kalibrasyonu limit fee ile yapılır", () => {
    const ctx: SpreadContext = { currentSpread: 20, normalSpread: 10 };
    const d = buildFeeSpreadDecision("LONG", px, 61800, 63600, ctx, feeCtx);
    expect(d.orderMode).toBe("limit");
    expect(d.feeAdjustedTp.totalFeeLoad).toBeCloseTo(2 * DEFAULT_MAKER_FEE);
  });

  it("wide spread → limit", () => {
    const ctx: SpreadContext = { currentSpread: 50, normalSpread: 10 };
    const d = buildFeeSpreadDecision("LONG", px, 61800, 63600, ctx, feeCtx);
    expect(d.orderMode).toBe("limit");
    expect(d.spread.condition).toBe("wide");
  });

  it("SHORT + elevated → limit, adjustedTp < originalTp", () => {
    const ctx: SpreadContext = { currentSpread: 20, normalSpread: 10 };
    const d = buildFeeSpreadDecision("SHORT", px, 58200, 56400, ctx, feeCtx);
    expect(d.orderMode).toBe("limit");
    expect(d.feeAdjustedTp.adjustedTp1).toBeLessThan(d.feeAdjustedTp.originalTp1);
  });
});

// ─── computePositionSize entegrasyonu ───────────────────────

describe("computePositionSize — fee/spread entegrasyonu", () => {
  it("feeContext/spreadContext verilmezse orderMode='market', feeAdjustedTp=tp", () => {
    const result = computePositionSize(makeInput());
    expect(result.orderMode).toBe("market");
    expect(result.feeAdjustedTp1).toBe(result.tp.tp1Price);
    expect(result.feeAdjustedTp2).toBe(result.tp.tp2Price);
  });

  it("normal spread + fee → orderMode='market', feeAdjustedTp > tp (LONG)", () => {
    const result = computePositionSize(makeInput({
      feeContext: { takerFeeRate: DEFAULT_TAKER_FEE, makerFeeRate: DEFAULT_MAKER_FEE },
      spreadContext: { currentSpread: 5, normalSpread: 10 }, // ratio=0.5 → normal
    }));
    expect(result.orderMode).toBe("market");
    expect(result.feeAdjustedTp1).toBeGreaterThan(result.tp.tp1Price);
    expect(result.feeAdjustedTp2).toBeGreaterThan(result.tp.tp2Price);
  });

  it("elevated spread → orderMode='limit', feeAdjustedTp kalibre edilir (maker fee)", () => {
    const result = computePositionSize(makeInput({
      feeContext: { takerFeeRate: DEFAULT_TAKER_FEE, makerFeeRate: DEFAULT_MAKER_FEE },
      spreadContext: { currentSpread: 20, normalSpread: 10 }, // ratio=2 → elevated
    }));
    expect(result.orderMode).toBe("limit");
    const expectedOffset = 2 * DEFAULT_MAKER_FEE * result.px;
    expect(result.feeAdjustedTp1).toBeCloseTo(result.tp.tp1Price + expectedOffset);
  });

  it("wide spread → orderMode='limit'", () => {
    const result = computePositionSize(makeInput({
      spreadContext: { currentSpread: 50, normalSpread: 10 },
    }));
    expect(result.orderMode).toBe("limit");
  });

  it("SHORT + elevated spread → feeAdjustedTp1 < tp.tp1Price", () => {
    const result = computePositionSize(makeInput({
      direction: "SHORT",
      spreadContext: { currentSpread: 20, normalSpread: 10 },
      feeContext: { takerFeeRate: DEFAULT_TAKER_FEE, makerFeeRate: DEFAULT_MAKER_FEE },
    }));
    expect(result.orderMode).toBe("limit");
    expect(result.feeAdjustedTp1).toBeLessThan(result.tp.tp1Price);
  });

  it("yüksek fee + normal spread → TP belirgin şekilde yukarı kayar", () => {
    const highFee = 0.002; // %0.2 (yüksek VIP olmayan tier)
    const result = computePositionSize(makeInput({
      feeContext: { takerFeeRate: highFee, makerFeeRate: highFee / 2 },
      spreadContext: { currentSpread: 5, normalSpread: 10 },
    }));
    const expectedLoad = 2 * highFee;
    const expectedOffset = expectedLoad * result.px;
    expect(result.feeAdjustedTp1).toBeCloseTo(result.tp.tp1Price + expectedOffset, 0);
  });

  it("drawdown locked → warnLevel='blocked', ama orderMode ve feeAdjustedTp hâlâ hesaplanır", () => {
    const result = computePositionSize(makeInput({
      drawdownProtocol: { tier: "locked", multiplier: 0, label: "Kilitli" },
      feeContext: defaultFeeContext(),
      spreadContext: { currentSpread: 20, normalSpread: 10 },
    }));
    expect(result.warnLevel).toBe("blocked");
    expect(result.orderMode).toBe("limit");
    expect(result.feeAdjustedTp1).toBeGreaterThanOrEqual(0);
  });

  it("spreadContext verilmez, sadece feeContext verilir → orderMode='market'", () => {
    const result = computePositionSize(makeInput({
      feeContext: { takerFeeRate: 0.001, makerFeeRate: 0.0005 },
    }));
    expect(result.orderMode).toBe("market");
    const expectedLoad = 2 * 0.001;
    const expectedOffset = expectedLoad * result.px;
    expect(result.feeAdjustedTp1).toBeCloseTo(result.tp.tp1Price + expectedOffset, 0);
  });
});

// ─── defaultFeeContext ───────────────────────────────────────

describe("defaultFeeContext", () => {
  it("OKX standart değerleri döndürür", () => {
    const ctx = defaultFeeContext();
    expect(ctx.takerFeeRate).toBe(DEFAULT_TAKER_FEE);
    expect(ctx.makerFeeRate).toBe(DEFAULT_MAKER_FEE);
    expect(ctx.lastFillFeeRate).toBeUndefined();
  });
});
