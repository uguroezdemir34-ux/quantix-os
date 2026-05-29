/**
 * P&L ENGINE + INVARIANT TESTS
 *
 * computeFee:
 *   - Taker fee: 2 × notional × rate (giriş + çıkış)
 *   - Funding: notional × rate × (hours/8)
 *   - Funding olmadan sadece taker
 *   - Default taker %0.05
 *   - Sıfır holding → sıfır funding
 *
 * computeRealizedPnl:
 *   - LONG kazanç: gross > 0, net < gross (fee düşüldü)
 *   - LONG kayıp: gross < 0, net < gross (fee büyüttü kaybı)
 *   - SHORT kazanç / kayıp
 *   - R-multiple doğruluğu
 *   - Fee ile net P&L
 *   - Pending/open trade → null
 *
 * computeUnrealizedPnl:
 *   - LONG: livePrice > entry → pozitif unrealized
 *   - LONG: livePrice < entry → negatif unrealized
 *   - SHORT: livePrice < entry → pozitif unrealized
 *   - SHORT: livePrice > entry → negatif unrealized
 *   - Accrued fee düşülür
 *   - livePrice ≤ 0 → null
 *   - Closed trade → null
 *
 * computeEquity:
 *   - Açık pozisyon yok → equity = balance
 *   - LONG pozitif unrealized → equity artar
 *   - LONG negatif unrealized → equity azalır
 *   - Çoklu açık pozisyon toplamı
 *   - Liveprices eksikse o pair atlanır
 *   - Closed/pending tradeler atlanır
 *
 * INVARIANT 1 — Equity ≥ 0:
 *   - equity = 0 → geçer (boundary)
 *   - equity > 0 → geçer
 *   - equity < 0 → InvariantError fırlatır
 *   - isEquityNonNegative soft versiyonu
 *
 * INVARIANT 2 — SL geçerliliği:
 *   - LONG: sl < entry → geçer
 *   - LONG: sl = entry → InvariantError
 *   - LONG: sl > entry → InvariantError
 *   - SHORT: sl > entry → geçer
 *   - SHORT: sl = entry → InvariantError
 *   - SHORT: sl < entry → InvariantError
 *   - isSlValid soft versiyonu
 *   - Live market price ile doğrulama
 *
 * Kombinasyon senaryoları:
 *   - Büyük kayıp → equity negatife düşer → invariant tetiklenir
 *   - Fee yüzünden net equity < 0 → invariant tetiklenir
 *   - Pozisyon açılmadan önce SL geçerlilik + equity check
 */

import { describe, it, expect } from "vitest";
import {
  computeFee,
  computeRealizedPnl,
  computeUnrealizedPnl,
  computeEquity,
  assertEquityNonNegative,
  assertSlValid,
  isEquityNonNegative,
  isSlValid,
  InvariantError,
  FEE_DEFAULTS,
} from "@/lib/pnl/engine";
import type { TradeSnapshot } from "@/lib/trades/types";

const NOW = 1_700_000_000_000;

// ─── Trade factory ────────────────────────────────────────────

function makeTrade(overrides: Partial<TradeSnapshot> = {}): TradeSnapshot {
  return {
    id: "t1",
    pair: "BTC",
    direction: "LONG",
    status: "open",
    openedAt: NOW - 3_600_000, // 1 saat önce
    entryPrice: 50000,
    qty: 0.1,
    leverage: 10,
    stopPrice: 49000,
    riskAmountUsd: 100,
    isPaper: false,
    entryContext: { score: 82, verdict: "go" },
    ...overrides,
  };
}

function makeClosedTrade(overrides: Partial<TradeSnapshot> = {}): TradeSnapshot {
  return makeTrade({
    status: "closed",
    exit: {
      closedAt: NOW,
      exitPrice: 51000,
      reason: "tp1",
      pnlUsd: 100, // (51000-50000)*0.1
      pnlPct: 0.02,
      holdingSec: 3600,
      rMultiple: 1.0,
    },
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────
// computeFee
// ─────────────────────────────────────────────────────────────

describe("computeFee() — taker fee", () => {
  it("default %0.05 taker fee, 2 taraf → 2 × notional × 0.0005", () => {
    const r = computeFee({ notionalUsd: 5000 });
    expect(r.takerFeeUsd).toBeCloseTo(5000 * 0.0005 * 2, 6);
    expect(r.fundingCostUsd).toBe(0);
    expect(r.totalFeeUsd).toBeCloseTo(r.takerFeeUsd, 6);
  });

  it("custom %0.02 taker fee", () => {
    const r = computeFee({ notionalUsd: 1000, takerFeePct: 0.0002 });
    expect(r.takerFeeUsd).toBeCloseTo(1000 * 0.0002 * 2, 6);
  });

  it("notional=0 → tüm fee sıfır", () => {
    const r = computeFee({ notionalUsd: 0 });
    expect(r.takerFeeUsd).toBe(0);
    expect(r.totalFeeUsd).toBe(0);
  });
});

describe("computeFee() — funding", () => {
  it("8 saatlik holding, 1 periyot funding", () => {
    // 8 saat = 1 periyot
    const r = computeFee({
      notionalUsd: 5000,
      fundingRatePct: 0.0001,
      holdingHours: 8,
    });
    // 1 periyot: 5000 × 0.0001 × 1 = 0.5
    expect(r.fundingCostUsd).toBeCloseTo(0.5, 6);
  });

  it("16 saatlik holding, 2 periyot funding", () => {
    const r = computeFee({
      notionalUsd: 5000,
      fundingRatePct: 0.0001,
      holdingHours: 16,
    });
    expect(r.fundingCostUsd).toBeCloseTo(1.0, 6);
  });

  it("holdingHours=0 → sıfır funding", () => {
    const r = computeFee({
      notionalUsd: 5000,
      fundingRatePct: 0.0001,
      holdingHours: 0,
    });
    expect(r.fundingCostUsd).toBe(0);
  });

  it("negatif funding rate → mutlak değer alınır", () => {
    const r1 = computeFee({ notionalUsd: 1000, fundingRatePct: 0.0002, holdingHours: 8 });
    const r2 = computeFee({ notionalUsd: 1000, fundingRatePct: -0.0002, holdingHours: 8 });
    expect(r1.fundingCostUsd).toBeCloseTo(r2.fundingCostUsd, 6);
  });

  it("totalFeeUsd = takerFee + fundingCost", () => {
    const r = computeFee({
      notionalUsd: 5000,
      takerFeePct: 0.0005,
      fundingRatePct: 0.0001,
      holdingHours: 8,
    });
    expect(r.totalFeeUsd).toBeCloseTo(r.takerFeeUsd + r.fundingCostUsd, 6);
  });

  it("FEE_DEFAULTS sabitler doğru", () => {
    expect(FEE_DEFAULTS.TAKER_FEE_PCT).toBe(0.0005);
    expect(FEE_DEFAULTS.FUNDING_PERIOD_HOURS).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────
// computeRealizedPnl
// ─────────────────────────────────────────────────────────────

describe("computeRealizedPnl() — LONG kazanç", () => {
  it("gross > 0, net < gross (fee düşüldü)", () => {
    const trade = makeClosedTrade({
      entryPrice: 50000,
      qty: 0.1,
      exit: {
        closedAt: NOW,
        exitPrice: 51000,
        reason: "tp1",
        pnlUsd: 100,
        pnlPct: 0.02,
        holdingSec: 3600,
      },
    });
    const r = computeRealizedPnl(trade);
    expect(r).not.toBeNull();
    expect(r!.grossPnlUsd).toBeCloseTo(100, 4);
    expect(r!.netPnlUsd).toBeLessThan(r!.grossPnlUsd);
  });

  it("fee doğru hesaplanır (entry 50000, qty 0.1 → notional 5000)", () => {
    const trade = makeClosedTrade();
    const r = computeRealizedPnl(trade, { takerFeePct: 0.0005 });
    // notional = 5000, fee = 5000 × 0.0005 × 2 = 5
    expect(r!.fees.takerFeeUsd).toBeCloseTo(5, 4);
    expect(r!.netPnlUsd).toBeCloseTo(100 - 5, 4);
  });

  it("R-multiple = netPnl / riskAmount", () => {
    const trade = makeClosedTrade({
      riskAmountUsd: 50,
      exit: { closedAt: NOW, exitPrice: 51000, reason: "tp1", pnlUsd: 100, pnlPct: 0.02, holdingSec: 3600 },
    });
    const r = computeRealizedPnl(trade, { takerFeePct: 0.0005 });
    // netPnl ≈ 100 - 5 = 95 / riskAmount=50 ≈ 1.9
    expect(r!.rMultiple).toBeCloseTo(95 / 50, 2);
  });
});

describe("computeRealizedPnl() — LONG kayıp", () => {
  it("gross < 0, net daha da düşük (fee kaybı büyüttü)", () => {
    const trade = makeClosedTrade({
      exit: {
        closedAt: NOW,
        exitPrice: 49000,
        reason: "sl",
        pnlUsd: -100, // (49000-50000)*0.1
        pnlPct: -0.02,
        holdingSec: 3600,
      },
    });
    const r = computeRealizedPnl(trade);
    expect(r!.grossPnlUsd).toBeCloseTo(-100, 4);
    expect(r!.netPnlUsd).toBeLessThan(r!.grossPnlUsd);
  });
});

describe("computeRealizedPnl() — SHORT", () => {
  it("SHORT kazanç: exit < entry → gross > 0", () => {
    const trade = makeClosedTrade({
      direction: "SHORT",
      entryPrice: 50000,
      qty: 0.1,
      exit: {
        closedAt: NOW,
        exitPrice: 49000,
        reason: "tp1",
        pnlUsd: 100, // (50000-49000)*0.1
        pnlPct: 0.02,
        holdingSec: 3600,
      },
    });
    const r = computeRealizedPnl(trade);
    expect(r!.grossPnlUsd).toBeCloseTo(100, 4);
    expect(r!.netPnlUsd).toBeLessThan(r!.grossPnlUsd);
  });

  it("SHORT kayıp: exit > entry → gross < 0", () => {
    const trade = makeClosedTrade({
      direction: "SHORT",
      exit: {
        closedAt: NOW,
        exitPrice: 51000,
        reason: "sl",
        pnlUsd: -100,
        pnlPct: -0.02,
        holdingSec: 3600,
      },
    });
    const r = computeRealizedPnl(trade);
    expect(r!.grossPnlUsd).toBeCloseTo(-100, 4);
  });
});

describe("computeRealizedPnl() — geçersiz girdi", () => {
  it("open trade → null", () => {
    expect(computeRealizedPnl(makeTrade({ status: "open" }))).toBeNull();
  });

  it("pending trade → null", () => {
    expect(computeRealizedPnl(makeTrade({ status: "pending" }))).toBeNull();
  });

  it("closed ama exit yok → null", () => {
    const t = makeTrade({ status: "closed" });
    expect(computeRealizedPnl(t)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// computeUnrealizedPnl
// ─────────────────────────────────────────────────────────────

describe("computeUnrealizedPnl() — LONG", () => {
  it("livePrice > entry → pozitif gross unrealized", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 0.1, direction: "LONG" });
    const r = computeUnrealizedPnl(trade, 51000, NOW);
    expect(r).not.toBeNull();
    // gross = (51000-50000)*0.1 = 100
    expect(r!.grossUnrealizedUsd).toBeCloseTo(100, 4);
    expect(r!.netUnrealizedUsd).toBeLessThan(r!.grossUnrealizedUsd);
  });

  it("livePrice < entry → negatif gross unrealized", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 0.1 });
    const r = computeUnrealizedPnl(trade, 49000, NOW);
    // gross = (49000-50000)*0.1 = -100
    expect(r!.grossUnrealizedUsd).toBeCloseTo(-100, 4);
    expect(r!.netUnrealizedUsd).toBeLessThan(r!.grossUnrealizedUsd);
  });

  it("livePrice = entry → gross = 0, net < 0 (sadece fee)", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 0.1 });
    const r = computeUnrealizedPnl(trade, 50000, NOW);
    expect(r!.grossUnrealizedUsd).toBeCloseTo(0, 4);
    expect(r!.netUnrealizedUsd).toBeLessThan(0); // fee düşüldü
  });
});

describe("computeUnrealizedPnl() — SHORT", () => {
  it("livePrice < entry → pozitif unrealized (short kazanıyor)", () => {
    const trade = makeTrade({ direction: "SHORT", entryPrice: 50000, qty: 0.1 });
    const r = computeUnrealizedPnl(trade, 49000, NOW);
    // gross = (49000-50000)*-1*0.1 = 100
    expect(r!.grossUnrealizedUsd).toBeCloseTo(100, 4);
  });

  it("livePrice > entry → negatif unrealized (short kaybediyor)", () => {
    const trade = makeTrade({ direction: "SHORT", entryPrice: 50000, qty: 0.1 });
    const r = computeUnrealizedPnl(trade, 51000, NOW);
    expect(r!.grossUnrealizedUsd).toBeCloseTo(-100, 4);
  });
});

describe("computeUnrealizedPnl() — geçersiz girdi", () => {
  it("livePrice=0 → null", () => {
    expect(computeUnrealizedPnl(makeTrade(), 0, NOW)).toBeNull();
  });

  it("livePrice=-1 → null", () => {
    expect(computeUnrealizedPnl(makeTrade(), -1, NOW)).toBeNull();
  });

  it("closed trade → null", () => {
    expect(computeUnrealizedPnl(makeClosedTrade(), 51000, NOW)).toBeNull();
  });

  it("pending trade → null", () => {
    expect(computeUnrealizedPnl(makeTrade({ status: "pending" }), 51000, NOW)).toBeNull();
  });
});

describe("computeUnrealizedPnl() — netPnlPct", () => {
  it("pozitif net → pozitif pct", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 0.1 });
    const r = computeUnrealizedPnl(trade, 55000, NOW);
    expect(r!.netUnrealizedPct).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// computeEquity
// ─────────────────────────────────────────────────────────────

describe("computeEquity() — açık pozisyon yok", () => {
  it("equity = balance", () => {
    const r = computeEquity(1000, [], {}, NOW);
    expect(r.equityUsd).toBe(1000);
    expect(r.totalUnrealizedUsd).toBe(0);
    expect(r.positions).toHaveLength(0);
  });
});

describe("computeEquity() — açık pozisyon var", () => {
  it("LONG pozitif unrealized → equity > balance", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 0.1 });
    const r = computeEquity(1000, [trade], { BTC: 51000 }, NOW);
    expect(r.equityUsd).toBeGreaterThan(1000);
    expect(r.positions).toHaveLength(1);
  });

  it("LONG negatif unrealized → equity < balance", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 1.0 });
    const r = computeEquity(1000, [trade], { BTC: 40000 }, NOW);
    // gross unrealized = (40000-50000)*1.0 = -10000
    expect(r.equityUsd).toBeLessThan(1000);
  });

  it("çoklu pozisyon toplamı", () => {
    const btc = makeTrade({ pair: "BTC", entryPrice: 50000, qty: 0.1 });
    const eth = makeTrade({ pair: "ETH", entryPrice: 3000, qty: 1.0, id: "t2" });
    const r = computeEquity(
      5000,
      [btc, eth],
      { BTC: 51000, ETH: 3100 },
      NOW,
    );
    // BTC gross = (51000-50000)*0.1 = 100
    // ETH gross = (3100-3000)*1.0 = 100
    // total gross ≈ 200, net daha az (fee düşüldü)
    expect(r.equityUsd).toBeGreaterThan(5000);
    expect(r.positions).toHaveLength(2);
  });

  it("livePrice eksik pair → o pozisyon atlanır", () => {
    const trade = makeTrade({ pair: "BTC" });
    const r = computeEquity(1000, [trade], { ETH: 3000 }, NOW);
    // BTC livePrice yok → atlanır
    expect(r.equityUsd).toBe(1000);
    expect(r.positions).toHaveLength(0);
  });

  it("closed/pending trade atlanır", () => {
    const closed = makeClosedTrade();
    const pending = makeTrade({ status: "pending" });
    const r = computeEquity(1000, [closed, pending], { BTC: 51000 }, NOW);
    expect(r.positions).toHaveLength(0);
    expect(r.equityUsd).toBe(1000);
  });
});

// ─────────────────────────────────────────────────────────────
// INVARIANT 1 — Equity ≥ 0
// ─────────────────────────────────────────────────────────────

describe("assertEquityNonNegative() — INVARİANT 1", () => {
  it("equity = 0 → geçer (sınır değer dahil)", () => {
    expect(() => assertEquityNonNegative(0)).not.toThrow();
  });

  it("equity = 0.01 → geçer", () => {
    expect(() => assertEquityNonNegative(0.01)).not.toThrow();
  });

  it("equity = 1000 → geçer", () => {
    expect(() => assertEquityNonNegative(1000)).not.toThrow();
  });

  it("equity = -0.01 → InvariantError fırlatır", () => {
    expect(() => assertEquityNonNegative(-0.01)).toThrow(InvariantError);
  });

  it("equity = -1000 → InvariantError fırlatır", () => {
    expect(() => assertEquityNonNegative(-1000)).toThrow(InvariantError);
  });

  it("hata mesajı 'negatif' bağlamını içerir", () => {
    expect(() => assertEquityNonNegative(-50)).toThrow(/Equity.*< 0/);
  });

  it("hata tipi InvariantError (not generic Error)", () => {
    try {
      assertEquityNonNegative(-1);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvariantError);
      expect((e as InvariantError).name).toBe("InvariantError");
    }
  });
});

describe("isEquityNonNegative() — soft version", () => {
  it("0 → true", () => expect(isEquityNonNegative(0)).toBe(true));
  it("100 → true", () => expect(isEquityNonNegative(100)).toBe(true));
  it("-0.01 → false", () => expect(isEquityNonNegative(-0.01)).toBe(false));
  it("-1000 → false", () => expect(isEquityNonNegative(-1000)).toBe(false));
});

// ─────────────────────────────────────────────────────────────
// INVARIANT 2 — SL Geçerliliği
// ─────────────────────────────────────────────────────────────

describe("assertSlValid() — LONG — INVARİANT 2", () => {
  it("sl < entry → geçer", () => {
    expect(() => assertSlValid(50000, 49000, "LONG")).not.toThrow();
  });

  it("sl = 1 (çok düşük) → geçer", () => {
    expect(() => assertSlValid(50000, 1, "LONG")).not.toThrow();
  });

  it("sl = entry → InvariantError", () => {
    expect(() => assertSlValid(50000, 50000, "LONG")).toThrow(InvariantError);
  });

  it("sl > entry → InvariantError", () => {
    expect(() => assertSlValid(50000, 51000, "LONG")).toThrow(InvariantError);
  });

  it("sl = entry + 0.01 → InvariantError (sınır +1 cent)", () => {
    expect(() => assertSlValid(50000, 50000.01, "LONG")).toThrow(InvariantError);
  });

  it("LONG SL hata mesajı 'BELOW entry' içerir", () => {
    expect(() => assertSlValid(50000, 51000, "LONG")).toThrow(/BELOW entry/);
  });
});

describe("assertSlValid() — SHORT — INVARİANT 2", () => {
  it("sl > entry → geçer", () => {
    expect(() => assertSlValid(50000, 51000, "SHORT")).not.toThrow();
  });

  it("sl = entry → InvariantError", () => {
    expect(() => assertSlValid(50000, 50000, "SHORT")).toThrow(InvariantError);
  });

  it("sl < entry → InvariantError", () => {
    expect(() => assertSlValid(50000, 49000, "SHORT")).toThrow(InvariantError);
  });

  it("SHORT SL hata mesajı 'ABOVE entry' içerir", () => {
    expect(() => assertSlValid(50000, 49000, "SHORT")).toThrow(/ABOVE entry/);
  });
});

describe("isSlValid() — soft version", () => {
  it("LONG sl < entry → true", () => expect(isSlValid(50000, 49000, "LONG")).toBe(true));
  it("LONG sl = entry → false", () => expect(isSlValid(50000, 50000, "LONG")).toBe(false));
  it("LONG sl > entry → false", () => expect(isSlValid(50000, 51000, "LONG")).toBe(false));
  it("SHORT sl > entry → true", () => expect(isSlValid(50000, 51000, "SHORT")).toBe(true));
  it("SHORT sl < entry → false", () => expect(isSlValid(50000, 49000, "SHORT")).toBe(false));
});

// ─────────────────────────────────────────────────────────────
// Kombinasyon Senaryoları
// ─────────────────────────────────────────────────────────────

describe("Kombinasyon — büyük kayıp → equity negatife → invariant", () => {
  it("bakiye 100, büyük short pozisyon ters gitti → equity < 0 → InvariantError", () => {
    // Balance = 100 USD, 1 BTC SHORT @ 50000, fiyat 51000'e çıktı
    // gross unrealized = (51000-50000)*-1*1 = -1000
    // equity = 100 - 1000 = -900 → invariant ihlal
    const trade = makeTrade({
      direction: "SHORT",
      entryPrice: 50000,
      qty: 1.0,
    });
    const eq = computeEquity(100, [trade], { BTC: 51000 }, NOW, { takerFeePct: 0 });
    expect(eq.equityUsd).toBeLessThan(0);
    expect(() => assertEquityNonNegative(eq.equityUsd)).toThrow(InvariantError);
  });

  it("bakiye 5000, küçük pozisyon → equity pozitif → invariant geçer", () => {
    const trade = makeTrade({ entryPrice: 50000, qty: 0.01 });
    const eq = computeEquity(5000, [trade], { BTC: 49000 }, NOW, { takerFeePct: 0 });
    // gross = (49000-50000)*0.01 = -10 → equity = 5000 - 10 = 4990
    expect(eq.equityUsd).toBeGreaterThan(0);
    expect(() => assertEquityNonNegative(eq.equityUsd)).not.toThrow();
  });
});

describe("Kombinasyon — pozisyon açılmadan önce çift kontrol", () => {
  it("geçerli SL + pozitif equity → her iki invariant geçer", () => {
    const entry = 50000;
    const sl = 49000;
    const equity = 1000;

    expect(() => assertSlValid(entry, sl, "LONG")).not.toThrow();
    expect(() => assertEquityNonNegative(equity)).not.toThrow();
  });

  it("geçersiz SL (LONG sl > entry) → assertSlValid fırlatır, equity'ye bakılmaz", () => {
    expect(() => assertSlValid(50000, 51000, "LONG")).toThrow(InvariantError);
  });

  it("geçerli SL ama equity sıfır → assertEquityNonNegative geçer (sınır = 0)", () => {
    expect(() => assertSlValid(50000, 49000, "LONG")).not.toThrow();
    expect(() => assertEquityNonNegative(0)).not.toThrow();
  });
});

describe("Kombinasyon — net P&L hesabı bütünlüğü", () => {
  it("realized + fee → net P&L mantıksal olarak tutarlı", () => {
    const trade = makeClosedTrade({
      entryPrice: 50000,
      qty: 0.2,
      riskAmountUsd: 200,
      exit: {
        closedAt: NOW,
        exitPrice: 52000,
        reason: "tp2",
        pnlUsd: 400, // (52000-50000)*0.2
        pnlPct: 0.04,
        holdingSec: 7200, // 2 saat
      },
    });

    const r = computeRealizedPnl(trade, {
      takerFeePct: 0.0005,
      fundingRatePct: 0.0001,
    });

    expect(r).not.toBeNull();
    // gross = 400
    // notional = 50000*0.2 = 10000
    // taker = 10000*0.0005*2 = 10
    // funding = 10000*0.0001*(2/8) = 0.25
    // net = 400 - 10.25 = 389.75
    expect(r!.grossPnlUsd).toBeCloseTo(400, 2);
    expect(r!.fees.takerFeeUsd).toBeCloseTo(10, 4);
    expect(r!.fees.fundingCostUsd).toBeCloseTo(0.25, 4);
    expect(r!.netPnlUsd).toBeCloseTo(389.75, 2);
    expect(r!.netPnlUsd).toBeLessThan(r!.grossPnlUsd);

    // rMultiple = 389.75 / 200 ≈ 1.95
    expect(r!.rMultiple).toBeCloseTo(389.75 / 200, 2);
  });
});
