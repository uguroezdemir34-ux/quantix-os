/**
 * EQUITY CURVE STATE MACHINE ENTEGRASYON TESTLERİ
 *
 * Eşik doğrulaması:
 *   Haftalık -5.0% → restricted (¼ risk)
 *   Haftalık -7.5% → locked (Full Halt)
 *   Aylık   -12.0% → locked (Siber Kilit)
 *   Öncelik: aylık > haftalık > günlük
 *
 * computeEquityHaltState:
 *   normal → active=false
 *   weekly_locked → active=true, reason=weekly_locked
 *   monthly_locked → active=true, reason=monthly_locked
 *   restricted → active=false (sadece locked halt açar)
 *
 * guardAgainstEquityHalt (Split-Brain Koruması):
 *   halt aktif değil → geçer
 *   halt aktif + pending trade → Error fırlatır
 *   halt aktif + open trade → Error fırlatır
 *   halt aktif değil + open trade → geçer
 *
 * forceCloseAllForEquityHalt:
 *   open trade → closed, reason=equity_halt, pnl hesabı doğru
 *   pending trade → closed, reason=equity_halt
 *   closed trade → dokunulmaz geçer
 *   karma liste → sadece open/pending kapanır
 *   LONG P&L: (exit-entry)*qty
 *   SHORT P&L: (entry-exit)*qty
 *   orijinal dizi immutable kalır
 *
 * Preflight entegrasyonu:
 *   haftalık -7.5% → blocked_equity_curve
 *   aylık -12.0% → blocked_equity_curve
 *   haftalık -5% (restricted) → geçer (preflight yalnızca locked bloke eder)
 *
 * Tam senaryo (Split-Brain):
 *   1. Trade pending oluşturulur
 *   2. Equity halt devreye girer (haftalık -7.5%)
 *   3. guardAgainstEquityHalt → Error
 *   4. forceCloseAllForEquityHalt → pending trade closed olur
 */

import { describe, it, expect } from "vitest";
import {
  computeEquityHaltState,
  guardAgainstEquityHalt,
  forceCloseAllForEquityHalt,
  createPendingTrade,
  confirmOpen,
} from "@/lib/trades/state";
import {
  computeEquityCurveDecision,
  weeklyEquityTier,
  monthlyEquityTier,
  EQUITY_THRESHOLDS,
} from "@/lib/risk/equity-curve";
import { runPreflightChecks } from "@/lib/orchestrator/preflight";
import type { EquityCurveInput } from "@/lib/risk/equity-curve";
import type { TradeSnapshot } from "@/lib/trades/types";
import type { OrchestrateInput, AccountStateSnapshot } from "@/lib/orchestrator/types";

const NOW = 1_700_000_000_000;

// ─── Trade Factory ───────────────────────────────────────────

function makePendingTrade(overrides: Partial<{
  pair: "BTC" | "ETH";
  direction: "LONG" | "SHORT";
  entryPrice: number;
  now: number;
}> = {}): TradeSnapshot {
  return createPendingTrade({
    pair: overrides.pair ?? "BTC",
    direction: overrides.direction ?? "LONG",
    entryPrice: overrides.entryPrice ?? 50000,
    qty: 0.01,
    leverage: 10,
    stopPrice: 49000,
    riskAmountUsd: 100,
    isPaper: false,
    entryContext: { score: 82, verdict: "go" },
    now: overrides.now ?? NOW,
  });
}

function makeOpenTrade(overrides: Partial<{
  pair: "BTC" | "ETH";
  direction: "LONG" | "SHORT";
  entryPrice: number;
}> = {}): TradeSnapshot {
  return confirmOpen(makePendingTrade(overrides));
}

// ─── Equity Curve Input Factory ──────────────────────────────

function curve(
  weeklyPnlPct: number,
  monthlyPnlPct: number,
  dailyPnlPct = 0,
): EquityCurveInput {
  return { dailyPnlPct, weeklyPnlPct, monthlyPnlPct };
}

// ─────────────────────────────────────────────────────────────
// 1. Eşik doğrulaması
// ─────────────────────────────────────────────────────────────

describe("EQUITY_THRESHOLDS sabitleri", () => {
  it("WEEKLY_RESTRICTED = -5.0", () => {
    expect(EQUITY_THRESHOLDS.WEEKLY_RESTRICTED).toBe(-5.0);
  });
  it("WEEKLY_LOCKED = -7.5", () => {
    expect(EQUITY_THRESHOLDS.WEEKLY_LOCKED).toBe(-7.5);
  });
  it("MONTHLY_LOCKED = -12.0", () => {
    expect(EQUITY_THRESHOLDS.MONTHLY_LOCKED).toBe(-12.0);
  });
});

describe("weeklyEquityTier() — güncellenmiş eşikler", () => {
  it("-4.9% → null", () => {
    expect(weeklyEquityTier(-4.9)).toBeNull();
  });
  it("-5.0% → restricted", () => {
    expect(weeklyEquityTier(-5.0)!.tier).toBe("restricted");
  });
  it("-7.4% → restricted (Full Halt eşiğinin hemen altı)", () => {
    expect(weeklyEquityTier(-7.4)!.tier).toBe("restricted");
  });
  it("-7.5% → locked (Full Halt)", () => {
    expect(weeklyEquityTier(-7.5)!.tier).toBe("locked");
  });
  it("-10% → locked", () => {
    expect(weeklyEquityTier(-10)!.tier).toBe("locked");
  });
  it("-7.5% label 'Full Halt' içerir", () => {
    expect(weeklyEquityTier(-7.5)!.label).toContain("Full Halt");
  });
});

describe("monthlyEquityTier() — güncellenmiş eşik", () => {
  it("-11.9% → null (Siber Kilit eşiğinin altı)", () => {
    expect(monthlyEquityTier(-11.9)).toBeNull();
  });
  it("-12.0% → locked (Siber Kilit)", () => {
    const r = monthlyEquityTier(-12.0);
    expect(r!.tier).toBe("locked");
    expect(r!.label).toContain("Siber Kilit");
  });
  it("-15% → locked", () => {
    expect(monthlyEquityTier(-15)!.tier).toBe("locked");
  });
});

describe("computeEquityCurveDecision() — öncelik (güncellenmiş)", () => {
  it("aylık -12% kazanır haftalık -7.5% üzerinden", () => {
    const r = computeEquityCurveDecision(curve(-7.5, -12.0));
    expect(r.triggeredBy).toBe("monthly");
    expect(r.tier).toBe("locked");
  });
  it("aylık OK, haftalık -7.5% → weekly locked", () => {
    const r = computeEquityCurveDecision(curve(-7.5, -3.0));
    expect(r.triggeredBy).toBe("weekly");
    expect(r.tier).toBe("locked");
  });
  it("aylık OK, haftalık -5% → weekly restricted", () => {
    const r = computeEquityCurveDecision(curve(-5.0, -3.0));
    expect(r.triggeredBy).toBe("weekly");
    expect(r.tier).toBe("restricted");
  });
  it("hepsi sıfır → normal", () => {
    const r = computeEquityCurveDecision(curve(0, 0));
    expect(r.tier).toBe("normal");
    expect(r.triggeredBy).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 2. computeEquityHaltState
// ─────────────────────────────────────────────────────────────

describe("computeEquityHaltState()", () => {
  it("normal → active=false", () => {
    const r = computeEquityHaltState(curve(0, 0));
    expect(r.active).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.triggeredAt).toBeNull();
  });

  it("restricted (-5% weekly) → active=false (halt sadece locked'da açılır)", () => {
    const r = computeEquityHaltState(curve(-5.0, 0));
    expect(r.active).toBe(false);
  });

  it("weekly_locked (-7.5%) → active=true, reason=weekly_locked", () => {
    const r = computeEquityHaltState(curve(-7.5, 0));
    expect(r.active).toBe(true);
    expect(r.reason).toBe("weekly_locked");
    expect(r.label).toContain("Halt");
  });

  it("monthly_locked (-12%) → active=true, reason=monthly_locked", () => {
    const r = computeEquityHaltState(curve(0, -12.0));
    expect(r.active).toBe(true);
    expect(r.reason).toBe("monthly_locked");
    expect(r.label).toContain("Siber Kilit");
  });

  it("aylık önceliği: -12% monthly + -7.5% weekly → monthly_locked", () => {
    const r = computeEquityHaltState(curve(-7.5, -12.0));
    expect(r.reason).toBe("monthly_locked");
  });

  it("günlük -3% tek başına halt açmaz (günlük preflight'ta)", () => {
    const r = computeEquityHaltState({ dailyPnlPct: -3.0, weeklyPnlPct: 0, monthlyPnlPct: 0 });
    expect(r.active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. guardAgainstEquityHalt — Split-Brain Koruması
// ─────────────────────────────────────────────────────────────

describe("guardAgainstEquityHalt() — halt yok → geçer", () => {
  it("active=false + pending trade → hata yok", () => {
    const trade = makePendingTrade();
    const halt = computeEquityHaltState(curve(0, 0));
    expect(() => guardAgainstEquityHalt(trade, halt)).not.toThrow();
  });

  it("active=false + open trade → hata yok", () => {
    const trade = makeOpenTrade();
    const halt = computeEquityHaltState(curve(0, 0));
    expect(() => guardAgainstEquityHalt(trade, halt)).not.toThrow();
  });
});

describe("guardAgainstEquityHalt() — halt aktif → Error", () => {
  it("weekly_locked + pending trade → Error fırlatır", () => {
    const trade = makePendingTrade();
    const halt = computeEquityHaltState(curve(-7.5, 0));
    expect(() => guardAgainstEquityHalt(trade, halt)).toThrow(/equity halt active/);
  });

  it("weekly_locked + open trade → Error fırlatır", () => {
    const trade = makeOpenTrade();
    const halt = computeEquityHaltState(curve(-7.5, 0));
    expect(() => guardAgainstEquityHalt(trade, halt)).toThrow(/equity halt active/);
  });

  it("monthly_locked + pending trade → Error mesajı monthly içerir", () => {
    const trade = makePendingTrade();
    const halt = computeEquityHaltState(curve(0, -12.0));
    expect(() => guardAgainstEquityHalt(trade, halt)).toThrow(/monthly_locked/);
  });

  it("restricted (active=false) + trade → hata yok", () => {
    const trade = makeOpenTrade();
    const halt = computeEquityHaltState(curve(-5.0, 0));
    expect(() => guardAgainstEquityHalt(trade, halt)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// 4. forceCloseAllForEquityHalt
// ─────────────────────────────────────────────────────────────

describe("forceCloseAllForEquityHalt() — temel kapatma", () => {
  it("open trade → closed, reason=equity_halt", () => {
    const trade = makeOpenTrade({ entryPrice: 50000, direction: "LONG" });
    const [closed] = forceCloseAllForEquityHalt([trade], 49000, NOW);
    expect(closed.status).toBe("closed");
    expect(closed.exit!.reason).toBe("equity_halt");
  });

  it("pending trade → closed, reason=equity_halt", () => {
    const trade = makePendingTrade();
    const [closed] = forceCloseAllForEquityHalt([trade], 50000, NOW);
    expect(closed.status).toBe("closed");
    expect(closed.exit!.reason).toBe("equity_halt");
  });

  it("closed trade → dokunulmaz", () => {
    const open = makeOpenTrade();
    const [alreadyClosed] = forceCloseAllForEquityHalt([open], 50000, NOW);
    const result = forceCloseAllForEquityHalt([alreadyClosed], 48000, NOW + 1000);
    expect(result[0].exit!.exitPrice).toBe(alreadyClosed.exit!.exitPrice);
  });
});

describe("forceCloseAllForEquityHalt() — P&L hesabı", () => {
  it("LONG: exit > entry → pozitif pnl", () => {
    const trade = makeOpenTrade({ entryPrice: 50000, direction: "LONG" });
    const [closed] = forceCloseAllForEquityHalt([trade], 51000, NOW);
    // pnl = (51000-50000)*0.01 = 10
    expect(closed.exit!.pnlUsd).toBeCloseTo(10, 5);
  });

  it("LONG: exit < entry → negatif pnl", () => {
    const trade = makeOpenTrade({ entryPrice: 50000, direction: "LONG" });
    const [closed] = forceCloseAllForEquityHalt([trade], 49000, NOW);
    expect(closed.exit!.pnlUsd).toBeCloseTo(-10, 5);
  });

  it("SHORT: exit < entry → pozitif pnl", () => {
    const trade = makeOpenTrade({ entryPrice: 50000, direction: "SHORT" });
    const [closed] = forceCloseAllForEquityHalt([trade], 49000, NOW);
    // pnl = (50000-49000)*0.01 = 10
    expect(closed.exit!.pnlUsd).toBeCloseTo(10, 5);
  });

  it("SHORT: exit > entry → negatif pnl", () => {
    const trade = makeOpenTrade({ entryPrice: 50000, direction: "SHORT" });
    const [closed] = forceCloseAllForEquityHalt([trade], 51000, NOW);
    expect(closed.exit!.pnlUsd).toBeCloseTo(-10, 5);
  });

  it("closedAt = now parametresi", () => {
    const trade = makeOpenTrade();
    const [closed] = forceCloseAllForEquityHalt([trade], 50000, NOW + 5000);
    expect(closed.exit!.closedAt).toBe(NOW + 5000);
  });
});

describe("forceCloseAllForEquityHalt() — karma liste", () => {
  it("open + pending + closed → sadece open/pending kapanır", () => {
    const open = makeOpenTrade();
    const pending = makePendingTrade();
    // closed oluştur
    const [alreadyClosed] = forceCloseAllForEquityHalt([makeOpenTrade()], 50000, NOW - 1000);

    const result = forceCloseAllForEquityHalt([open, pending, alreadyClosed], 49500, NOW);

    expect(result).toHaveLength(3);
    expect(result[0].status).toBe("closed");
    expect(result[1].status).toBe("closed");
    // alreadyClosed dokunulmaz — exit price orijinal
    expect(result[2].exit!.exitPrice).toBe(50000);
  });

  it("boş liste → boş döner", () => {
    expect(forceCloseAllForEquityHalt([], 50000, NOW)).toHaveLength(0);
  });
});

describe("forceCloseAllForEquityHalt() — immutability", () => {
  it("orijinal dizi değişmez", () => {
    const trade = makeOpenTrade();
    const original = [trade];
    forceCloseAllForEquityHalt(original, 50000, NOW);
    expect(original[0].status).toBe("open");
  });

  it("orijinal trade nesnesi değişmez", () => {
    const trade = makeOpenTrade();
    forceCloseAllForEquityHalt([trade], 50000, NOW);
    expect(trade.status).toBe("open");
    expect(trade.exit).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Tam Split-Brain Senaryosu
// ─────────────────────────────────────────────────────────────

describe("Tam Split-Brain Senaryosu", () => {
  it("trade pending → halt devreye girer → confirmOpen engellenebilir → forceClose", () => {
    // 1. Trade oluşturuldu (henüz exchange confirm yok)
    const pending = makePendingTrade({ entryPrice: 50000 });
    expect(pending.status).toBe("pending");

    // 2. Bu arada haftalık kayıp -7.5%'e ulaştı
    const halt = computeEquityHaltState(curve(-7.5, 0));
    expect(halt.active).toBe(true);
    expect(halt.reason).toBe("weekly_locked");

    // 3. confirmOpen çağrılmadan önce guard → Error (split-brain önlendi)
    expect(() => guardAgainstEquityHalt(pending, halt)).toThrow();

    // 4. forceClose ile pending trade kapatılır (rollback senaryosu)
    const [closed] = forceCloseAllForEquityHalt([pending], 50000, NOW);
    expect(closed.status).toBe("closed");
    expect(closed.exit!.reason).toBe("equity_halt");
  });

  it("aylık siber kilit: -12% → halt → tüm portföy kapatılır", () => {
    const trades = [
      makeOpenTrade({ pair: "BTC", direction: "LONG", entryPrice: 50000 }),
      makeOpenTrade({ pair: "ETH", direction: "SHORT", entryPrice: 3000 }),
      makePendingTrade({ pair: "BTC", direction: "SHORT" }),
    ];

    const halt = computeEquityHaltState(curve(0, -12.0));
    expect(halt.active).toBe(true);
    expect(halt.reason).toBe("monthly_locked");

    const closed = forceCloseAllForEquityHalt(trades, 49500, NOW);
    expect(closed.every((t) => t.status === "closed")).toBe(true);
    expect(closed.every((t) => t.exit!.reason === "equity_halt")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Preflight Entegrasyonu — güncellenmiş eşiklerle
// ─────────────────────────────────────────────────────────────

function makeSignal(verdict: "go" | "wait" | "no" = "go") {
  return {
    verdict,
    direction: "LONG" as const,
    total: 85,
    effectiveThreshold: 80,
    baseScore: 80,
    scorers: [],
    humanSummary: "test",
    pair: "BTC" as const,
  };
}

function makeAccount(overrides: Partial<AccountStateSnapshot> = {}): AccountStateSnapshot {
  return {
    drawdownProtocol: { tier: "normal", multiplier: 1, label: "Normal" },
    btcCooldownUntil: 0,
    btcSelfCooldownUntil: 0,
    todayTradeCount: 0,
    maxTradesPerDay: 2,
    ...overrides,
  };
}

function makeInput(overrides: Partial<OrchestrateInput> = {}): OrchestrateInput {
  return {
    signal: makeSignal("go"),
    pair: "BTC",
    livePrice: 50000,
    qty: 0.01,
    stopPrice: 49000,
    leverage: 10,
    marginMode: "cross",
    source: "bot",
    accountState: makeAccount(),
    ...overrides,
  };
}

describe("Preflight — haftalık Full Halt (-7.5%)", () => {
  it("haftalık -7.5% → blocked_equity_curve", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -7.5, monthlyPnlPct: 0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_equity_curve");
    expect(r.reasonHuman).toContain("7.5");
  });

  it("haftalık -5% (restricted) → preflight geçer (sadece locked bloke eder)", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -5.0, monthlyPnlPct: 0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(true);
  });
});

describe("Preflight — aylık Siber Kilit (-12%)", () => {
  it("aylık -12% → blocked_equity_curve", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: 0, monthlyPnlPct: -12.0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_equity_curve");
    expect(r.reasonHuman).toContain("12");
  });

  it("aylık -11.9% → geçer (eşiğin hemen altı)", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: 0, monthlyPnlPct: -11.9 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(true);
  });

  it("aylık -12% haftalık -7.5% ile birlikte → yine blocked_equity_curve", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -7.5, monthlyPnlPct: -12.0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_equity_curve");
  });
});
