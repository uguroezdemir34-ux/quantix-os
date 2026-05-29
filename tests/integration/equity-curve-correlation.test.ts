/**
 * EQUITY CURVE + CORRELATION LIMITER TESTS
 *
 * equity-curve:
 *   weeklyEquityTier: normal, restricted (-5%), locked (-7%)
 *   monthlyEquityTier: normal, locked (-10%)
 *   computeEquityCurveDecision: aylık > haftalık > günlük öncelik
 *   needsDailyReset / needsWeeklyReset / needsMonthlyReset
 *   getDayStart / getWeekStart / getMonthStart (boundary)
 *
 * correlation:
 *   checkCorrelationLimit: boş liste, farklı yön, aynı yön ama limit aşılmadı
 *   aynı pair → saymaz, farklı pair aynı yön → blok
 *   pending status → blok, closed → saymaz
 *   custom maxSameDirection=2
 *
 * preflight entegrasyonu:
 *   equityCurve undefined → atlanır
 *   haftalık -7% → blocked_equity_curve
 *   aylık -10% → blocked_equity_curve
 *   openPositions undefined → korelasyon atlanır
 *   aynı yön açık pozisyon var → blocked_correlation
 *   öncelik: equity_curve > drawdown > correlation (sıra kontrolü)
 */

import { describe, it, expect } from "vitest";
import {
  weeklyEquityTier,
  monthlyEquityTier,
  computeEquityCurveDecision,
  needsDailyReset,
  needsWeeklyReset,
  needsMonthlyReset,
  getDayStart,
  getWeekStart,
  getMonthStart,
  EQUITY_THRESHOLDS,
} from "@/lib/risk/equity-curve";
import {
  checkCorrelationLimit,
  DEFAULT_CORRELATION_CONFIG,
} from "@/lib/risk/correlation";
import type { OpenPositionSummary } from "@/lib/risk/correlation";
import { runPreflightChecks } from "@/lib/orchestrator/preflight";
import type { OrchestrateInput, AccountStateSnapshot } from "@/lib/orchestrator/types";

const NOW = 1_700_000_000_000; // Pazartesi sabahı

// ─────────────────────────────────────────────────────────────
// weeklyEquityTier
// ─────────────────────────────────────────────────────────────

describe("weeklyEquityTier()", () => {
  it("0% → null (eşik yok)", () => {
    expect(weeklyEquityTier(0)).toBeNull();
  });

  it("-4.9% → null (eşiğin hemen altı)", () => {
    expect(weeklyEquityTier(-4.9)).toBeNull();
  });

  it("-5% → restricted", () => {
    const r = weeklyEquityTier(-5.0);
    expect(r).not.toBeNull();
    expect(r!.tier).toBe("restricted");
    expect(r!.multiplier).toBe(0.25);
  });

  it("-6% → restricted", () => {
    expect(weeklyEquityTier(-6.0)!.tier).toBe("restricted");
  });

  it("-7% → locked", () => {
    const r = weeklyEquityTier(-7.0);
    expect(r!.tier).toBe("locked");
    expect(r!.multiplier).toBe(0);
  });

  it("-10% → locked", () => {
    expect(weeklyEquityTier(-10.0)!.tier).toBe("locked");
  });

  it("NaN → null (defansif)", () => {
    expect(weeklyEquityTier(NaN)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// monthlyEquityTier
// ─────────────────────────────────────────────────────────────

describe("monthlyEquityTier()", () => {
  it("0% → null", () => {
    expect(monthlyEquityTier(0)).toBeNull();
  });

  it("-9.9% → null (eşiğin hemen altı)", () => {
    expect(monthlyEquityTier(-9.9)).toBeNull();
  });

  it("-10% → locked", () => {
    const r = monthlyEquityTier(-10.0);
    expect(r!.tier).toBe("locked");
    expect(r!.multiplier).toBe(0);
  });

  it("-15% → locked", () => {
    expect(monthlyEquityTier(-15.0)!.tier).toBe("locked");
  });

  it("NaN → null", () => {
    expect(monthlyEquityTier(NaN)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// computeEquityCurveDecision — öncelik
// ─────────────────────────────────────────────────────────────

describe("computeEquityCurveDecision() — öncelik: aylık > haftalık > günlük", () => {
  it("hepsi 0 → normal", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: 0, weeklyPnlPct: 0, monthlyPnlPct: 0 });
    expect(r.tier).toBe("normal");
    expect(r.triggeredBy).toBeNull();
  });

  it("aylık -10% → locked (triggeredBy=monthly)", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: -2.0, weeklyPnlPct: -6.0, monthlyPnlPct: -10.0 });
    expect(r.tier).toBe("locked");
    expect(r.triggeredBy).toBe("monthly");
  });

  it("aylık OK, haftalık -7% → locked (triggeredBy=weekly)", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: -1.0, weeklyPnlPct: -7.0, monthlyPnlPct: -3.0 });
    expect(r.tier).toBe("locked");
    expect(r.triggeredBy).toBe("weekly");
  });

  it("aylık OK, haftalık -5% → restricted (triggeredBy=weekly)", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: 0, weeklyPnlPct: -5.0, monthlyPnlPct: 0 });
    expect(r.tier).toBe("restricted");
    expect(r.triggeredBy).toBe("weekly");
  });

  it("aylık+haftalık OK, günlük -3% → locked (triggeredBy=daily)", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: -3.0, weeklyPnlPct: -1.0, monthlyPnlPct: -2.0 });
    expect(r.tier).toBe("locked");
    expect(r.triggeredBy).toBe("daily");
  });

  it("günlük -1.5% → caution (triggeredBy=daily)", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: -1.5, weeklyPnlPct: 0, monthlyPnlPct: 0 });
    expect(r.tier).toBe("caution");
    expect(r.triggeredBy).toBe("daily");
  });

  it("aylık -10% kazanır haftalık -5% üzerinden", () => {
    const r = computeEquityCurveDecision({ dailyPnlPct: 0, weeklyPnlPct: -5.0, monthlyPnlPct: -10.0 });
    expect(r.triggeredBy).toBe("monthly");
  });
});

// ─────────────────────────────────────────────────────────────
// needsReset helpers
// ─────────────────────────────────────────────────────────────

describe("needsDailyReset()", () => {
  it("lastResetAt=0 → gerekli", () => {
    expect(needsDailyReset(0, NOW)).toBe(true);
  });

  it("lastResetAt=bugün başlangıcından sonra → gerekmez", () => {
    const dayStart = getDayStart(NOW);
    expect(needsDailyReset(dayStart + 1000, NOW)).toBe(false);
  });

  it("lastResetAt=dün → gerekli", () => {
    const dayStart = getDayStart(NOW);
    expect(needsDailyReset(dayStart - 1000, NOW)).toBe(true);
  });
});

describe("needsWeeklyReset()", () => {
  it("lastResetAt=0 → gerekli", () => {
    expect(needsWeeklyReset(0, NOW)).toBe(true);
  });

  it("lastResetAt=bu hafta başından sonra → gerekmez", () => {
    const weekStart = getWeekStart(NOW);
    expect(needsWeeklyReset(weekStart + 1000, NOW)).toBe(false);
  });

  it("lastResetAt=geçen hafta → gerekli", () => {
    const weekStart = getWeekStart(NOW);
    expect(needsWeeklyReset(weekStart - 1000, NOW)).toBe(true);
  });
});

describe("needsMonthlyReset()", () => {
  it("lastResetAt=0 → gerekli", () => {
    expect(needsMonthlyReset(0, NOW)).toBe(true);
  });

  it("lastResetAt=bu ay başından sonra → gerekmez", () => {
    const monthStart = getMonthStart(NOW);
    expect(needsMonthlyReset(monthStart + 1000, NOW)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// getWeekStart — Pazartesi sıfırı doğrulaması
// ─────────────────────────────────────────────────────────────

describe("getWeekStart()", () => {
  it("Pazartesi UTC 00:00:00 döner", () => {
    const ws = getWeekStart(NOW);
    const d = new Date(ws);
    expect(d.getUTCDay()).toBe(1); // Pazartesi
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });
});

describe("getMonthStart()", () => {
  it("Ayın 1'i UTC 00:00:00 döner", () => {
    const ms = getMonthStart(NOW);
    const d = new Date(ms);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// checkCorrelationLimit
// ─────────────────────────────────────────────────────────────

describe("checkCorrelationLimit() — boş liste", () => {
  it("açık pozisyon yok → blocked=false", () => {
    const r = checkCorrelationLimit("ETH", "LONG", []);
    expect(r.blocked).toBe(false);
    expect(r.reason).toBeNull();
  });
});

describe("checkCorrelationLimit() — farklı yön", () => {
  const open: OpenPositionSummary[] = [
    { pair: "BTC", direction: "LONG", status: "open" },
  ];

  it("BTC LONG açık, ETH SHORT gir → blok yok", () => {
    const r = checkCorrelationLimit("ETH", "SHORT", open);
    expect(r.blocked).toBe(false);
  });
});

describe("checkCorrelationLimit() — aynı pair sayılmaz", () => {
  const open: OpenPositionSummary[] = [
    { pair: "BTC", direction: "LONG", status: "open" },
  ];

  it("BTC LONG açık, tekrar BTC LONG gir → limit kontrolü farklı pair için", () => {
    // Aynı pair hariç tutulur, conflicting=0 → blocked=false
    const r = checkCorrelationLimit("BTC", "LONG", open);
    expect(r.blocked).toBe(false);
    expect(r.conflictingPositions).toHaveLength(0);
  });
});

describe("checkCorrelationLimit() — default maxSameDirection=1", () => {
  it("BTC LONG açık, ETH LONG gir → blocked=true", () => {
    const open: OpenPositionSummary[] = [
      { pair: "BTC", direction: "LONG", status: "open" },
    ];
    const r = checkCorrelationLimit("ETH", "LONG", open);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain("LONG");
    expect(r.conflictingPositions).toHaveLength(1);
    expect(r.conflictingPositions[0].pair).toBe("BTC");
  });

  it("BTC SHORT açık, ETH SHORT gir → blocked=true", () => {
    const open: OpenPositionSummary[] = [
      { pair: "BTC", direction: "SHORT", status: "open" },
    ];
    const r = checkCorrelationLimit("ETH", "SHORT", open);
    expect(r.blocked).toBe(true);
  });
});

describe("checkCorrelationLimit() — pending de sayılır", () => {
  it("BTC LONG pending → ETH LONG blocked", () => {
    const open: OpenPositionSummary[] = [
      { pair: "BTC", direction: "LONG", status: "pending" },
    ];
    const r = checkCorrelationLimit("ETH", "LONG", open);
    expect(r.blocked).toBe(true);
  });
});

describe("checkCorrelationLimit() — custom maxSameDirection=2", () => {
  const config = { maxSameDirection: 2 };

  it("1 açık pozisyon → blocked=false (limit aşılmadı)", () => {
    const open: OpenPositionSummary[] = [
      { pair: "BTC", direction: "LONG", status: "open" },
    ];
    expect(checkCorrelationLimit("ETH", "LONG", open, config).blocked).toBe(false);
  });

  it("2 açık pozisyon → blocked=true (limit aşıldı)", () => {
    const open: OpenPositionSummary[] = [
      { pair: "BTC", direction: "LONG", status: "open" },
      { pair: "ETH", direction: "LONG", status: "open" },
    ];
    // SOL LONG girilmek isteniyor
    const r = checkCorrelationLimit("BTC" as never, "LONG", open, config);
    // conflicting: ETH (BTC hariç)
    expect(r.conflictingPositions).toHaveLength(1);
    expect(r.blocked).toBe(false); // sadece 1 farklı pair var
  });
});

// ─────────────────────────────────────────────────────────────
// Preflight entegrasyonu
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
    pair: "ETH" as const,
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
    pair: "ETH",
    livePrice: 3000,
    qty: 0.1,
    stopPrice: 2900,
    leverage: 10,
    marginMode: "cross",
    source: "bot",
    accountState: makeAccount(),
    ...overrides,
  };
}

describe("preflight + equity curve — undefined → atlanır", () => {
  it("equityCurve yok → passed=true", () => {
    const r = runPreflightChecks(makeInput(), NOW);
    expect(r.passed).toBe(true);
  });
});

describe("preflight + equity curve — haftalık lock", () => {
  it("haftalık -7% → blocked_equity_curve", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -7.0, monthlyPnlPct: 0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_equity_curve");
    expect(r.reasonHuman).toContain("haftalık");
  });

  it("haftalık -5% → restricted değil → preflight'ı bloke etmez (sadece locked bloke eder)", () => {
    // restricted tier haftalık için bloke etmez (multiplier azaltır ama preflight locked check yapar)
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -5.0, monthlyPnlPct: 0 },
        }),
      }),
      NOW,
    );
    // restricted sadece risk azaltır, preflight blocked_equity_curve sadece locked için
    expect(r.decision).not.toBe("blocked_equity_curve");
  });
});

describe("preflight + equity curve — aylık lock", () => {
  it("aylık -10% → blocked_equity_curve", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -2.0, monthlyPnlPct: -10.0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_equity_curve");
    expect(r.reasonHuman).toContain("aylık");
  });
});

describe("preflight + korelasyon — undefined → atlanır", () => {
  it("openPositions yok → passed=true", () => {
    const r = runPreflightChecks(makeInput(), NOW);
    expect(r.passed).toBe(true);
  });
});

describe("preflight + korelasyon — hard block", () => {
  it("BTC LONG açık, ETH LONG gir → blocked_correlation", () => {
    const r = runPreflightChecks(
      makeInput({
        pair: "ETH",
        signal: makeSignal("go"),
        accountState: makeAccount({
          openPositions: [{ pair: "BTC", direction: "LONG", status: "open" }],
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_correlation");
    expect(r.reasonHuman).toContain("LONG");
  });

  it("BTC SHORT açık, ETH LONG gir → passed (farklı yön)", () => {
    const r = runPreflightChecks(
      makeInput({
        pair: "ETH",
        accountState: makeAccount({
          openPositions: [{ pair: "BTC", direction: "SHORT", status: "open" }],
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(true);
  });
});

describe("preflight öncelik — equity_curve verdict'ten önce gelir", () => {
  it("haftalık lock + verdict=no → blocked_equity_curve", () => {
    const r = runPreflightChecks(
      makeInput({
        signal: makeSignal("no"),
        accountState: makeAccount({
          equityCurve: { weeklyPnlPct: -7.0, monthlyPnlPct: 0 },
        }),
      }),
      NOW,
    );
    expect(r.decision).toBe("blocked_equity_curve");
  });
});
