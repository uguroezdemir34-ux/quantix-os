/**
 * CIRCUIT BREAKER TESTS
 *
 * checkPriceFrozen:
 *   - healthy: lastTickAt çok yakın
 *   - stale_warn: 8-15s arasında
 *   - frozen: 15s+ veya lastTickAt=0
 *   - shouldBlock yalnızca frozen'da true
 *   - staleSec doğru hesap
 *   - custom eşikler
 *
 * checkDataHealth:
 *   - frozen → healthy=false, reason dolu
 *   - WS silent + stale_warn → healthy=false (ikili koşul)
 *   - WS connected + stale_warn → healthy=true (sadece warn)
 *   - WS disconnected + healthy tick → healthy=true (tek koşul yetmez)
 *   - idle/connecting ile stale_warn → healthy=true (unhealthy statüs değil)
 *
 * preflight entegrasyonu:
 *   - dataHealth undefined → kontrol atlanır
 *   - frozen veri → blocked_data_frozen
 *   - sağlıklı veri + go verdict → passed=true
 *   - circuit breaker verdict check'ten önce gelir (öncelik 0)
 */

import { describe, it, expect } from "vitest";
import {
  checkPriceFrozen,
  checkDataHealth,
  CIRCUIT_BREAKER_CONSTANTS,
} from "@/lib/orchestrator/circuit-breaker";
import { runPreflightChecks } from "@/lib/orchestrator/preflight";
import type { OrchestrateInput, AccountStateSnapshot } from "@/lib/orchestrator/types";

const NOW = 1_700_000_000_000;
const { PRICE_FROZEN_MS, STALE_WARN_MS } = CIRCUIT_BREAKER_CONSTANTS;

// ─────────────────────────────────────────────────────────────
// checkPriceFrozen
// ─────────────────────────────────────────────────────────────

describe("checkPriceFrozen() — status", () => {
  it("lastTickAt=now → healthy", () => {
    const r = checkPriceFrozen(NOW, NOW);
    expect(r.status).toBe("healthy");
    expect(r.shouldBlock).toBe(false);
    expect(r.staleSec).toBe(0);
  });

  it("lastTickAt=now-1s → healthy", () => {
    const r = checkPriceFrozen(NOW - 1000, NOW);
    expect(r.status).toBe("healthy");
    expect(r.shouldBlock).toBe(false);
  });

  it("lastTickAt=now-7999ms → healthy (stale eşiğin altı)", () => {
    const r = checkPriceFrozen(NOW - (STALE_WARN_MS - 1), NOW);
    expect(r.status).toBe("healthy");
  });

  it("lastTickAt=now-8000ms → stale_warn", () => {
    const r = checkPriceFrozen(NOW - STALE_WARN_MS, NOW);
    expect(r.status).toBe("stale_warn");
    expect(r.shouldBlock).toBe(false);
  });

  it("lastTickAt=now-10s → stale_warn", () => {
    const r = checkPriceFrozen(NOW - 10_000, NOW);
    expect(r.status).toBe("stale_warn");
    expect(r.shouldBlock).toBe(false);
  });

  it("lastTickAt=now-14999ms → stale_warn (frozen eşiğin hemen altı)", () => {
    const r = checkPriceFrozen(NOW - (PRICE_FROZEN_MS - 1), NOW);
    expect(r.status).toBe("stale_warn");
  });

  it("lastTickAt=now-15000ms → frozen (boundary dahil)", () => {
    const r = checkPriceFrozen(NOW - PRICE_FROZEN_MS, NOW);
    expect(r.status).toBe("frozen");
    expect(r.shouldBlock).toBe(true);
  });

  it("lastTickAt=now-30s → frozen", () => {
    const r = checkPriceFrozen(NOW - 30_000, NOW);
    expect(r.status).toBe("frozen");
    expect(r.shouldBlock).toBe(true);
  });

  it("lastTickAt=0 (hiç tick gelmedi) → frozen", () => {
    const r = checkPriceFrozen(0, NOW);
    expect(r.status).toBe("frozen");
    expect(r.shouldBlock).toBe(true);
  });
});

describe("checkPriceFrozen() — staleSec", () => {
  it("5s önce → staleSec=5", () => {
    const r = checkPriceFrozen(NOW - 5000, NOW);
    expect(r.staleSec).toBe(5);
  });

  it("12s önce → staleSec=12", () => {
    const r = checkPriceFrozen(NOW - 12_000, NOW);
    expect(r.staleSec).toBe(12);
  });

  it("20s önce → staleSec=20", () => {
    const r = checkPriceFrozen(NOW - 20_000, NOW);
    expect(r.staleSec).toBe(20);
  });
});

describe("checkPriceFrozen() — custom eşikler", () => {
  it("frozenMs=5000: 5s → frozen", () => {
    const r = checkPriceFrozen(NOW - 5000, NOW, 5000, 2000);
    expect(r.status).toBe("frozen");
  });

  it("frozenMs=30000: 15s → stale_warn", () => {
    const r = checkPriceFrozen(NOW - 15_000, NOW, 30_000, 8_000);
    expect(r.status).toBe("stale_warn");
    expect(r.shouldBlock).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// checkDataHealth
// ─────────────────────────────────────────────────────────────

describe("checkDataHealth() — frozen her zaman bloklar", () => {
  it("frozen + connected → unhealthy", () => {
    const r = checkDataHealth("connected", 0, NOW);
    expect(r.healthy).toBe(false);
    expect(r.reason).not.toBeNull();
    expect(r.reason).toContain("frozen");
  });

  it("frozen + silent → unhealthy", () => {
    const r = checkDataHealth("silent", 0, NOW);
    expect(r.healthy).toBe(false);
  });

  it("frozen + disconnected → unhealthy", () => {
    const r = checkDataHealth("disconnected", NOW - 30_000, NOW);
    expect(r.healthy).toBe(false);
  });
});

describe("checkDataHealth() — WS unhealthy + stale_warn kombinasyonu", () => {
  // stale_warn = 8-15s arasında, WS silent/disconnected → blok
  it("silent + 9s stale → unhealthy", () => {
    const r = checkDataHealth("silent", NOW - 9000, NOW);
    expect(r.healthy).toBe(false);
    expect(r.reason).toContain("silent");
  });

  it("disconnected + 10s stale → unhealthy", () => {
    const r = checkDataHealth("disconnected", NOW - 10_000, NOW);
    expect(r.healthy).toBe(false);
  });

  it("destroyed + 9s stale → unhealthy", () => {
    const r = checkDataHealth("destroyed", NOW - 9000, NOW);
    expect(r.healthy).toBe(false);
  });
});

describe("checkDataHealth() — tek koşul yetmez → healthy", () => {
  it("connected + 9s stale → healthy (stale ama WS sağlıklı)", () => {
    const r = checkDataHealth("connected", NOW - 9000, NOW);
    expect(r.healthy).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("silent + 2s stale → healthy (WS unhealthy ama veri taze)", () => {
    const r = checkDataHealth("silent", NOW - 2000, NOW);
    expect(r.healthy).toBe(true);
  });

  it("idle + 9s stale → healthy (idle = unhealthy statüs değil)", () => {
    const r = checkDataHealth("idle", NOW - 9000, NOW);
    expect(r.healthy).toBe(true);
  });

  it("connecting + 9s stale → healthy", () => {
    const r = checkDataHealth("connecting", NOW - 9000, NOW);
    expect(r.healthy).toBe(true);
  });
});

describe("checkDataHealth() — frozen alanı her zaman dolu", () => {
  it("healthy sonuçta frozen.status var", () => {
    const r = checkDataHealth("connected", NOW - 1000, NOW);
    expect(r.frozen).toBeDefined();
    expect(r.frozen.status).toBe("healthy");
  });

  it("unhealthy sonuçta frozen.shouldBlock var", () => {
    const r = checkDataHealth("connected", 0, NOW);
    expect(r.frozen.shouldBlock).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// preflight entegrasyonu
// ─────────────────────────────────────────────────────────────

// Minimal ScoreResult mock
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

describe("preflight + circuit breaker — dataHealth undefined", () => {
  it("dataHealth yoksa kontrol atlanır, verdict go → passed", () => {
    const r = runPreflightChecks(makeInput(), NOW);
    expect(r.passed).toBe(true);
  });
});

describe("preflight + circuit breaker — frozen → blocked", () => {
  it("lastTickAt=0 → blocked_data_frozen", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          dataHealth: { connectionStatus: "connected", lastTickAt: 0 },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_data_frozen");
  });

  it("15s+ frozen → blocked_data_frozen", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          dataHealth: {
            connectionStatus: "connected",
            lastTickAt: NOW - 20_000,
          },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_data_frozen");
    expect(r.reasonHuman).toContain("frozen");
  });

  it("silent + 9s stale → blocked_data_frozen", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          dataHealth: {
            connectionStatus: "silent",
            lastTickAt: NOW - 9000,
          },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_data_frozen");
  });
});

describe("preflight + circuit breaker — sağlıklı veri", () => {
  it("taze tick + connected → passed", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          dataHealth: {
            connectionStatus: "connected",
            lastTickAt: NOW - 1000,
          },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(true);
  });

  it("taze tick + silent → passed (veri taze, WS durumu tek başına blok değil)", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          dataHealth: {
            connectionStatus: "silent",
            lastTickAt: NOW - 2000,
          },
        }),
      }),
      NOW,
    );
    expect(r.passed).toBe(true);
  });
});

describe("preflight öncelik — circuit breaker verdict'ten önce gelir", () => {
  it("frozen veri + verdict=no → blocked_data_frozen (data check 0. önce)", () => {
    const r = runPreflightChecks(
      makeInput({
        signal: makeSignal("no"),
        accountState: makeAccount({
          dataHealth: { connectionStatus: "connected", lastTickAt: 0 },
        }),
      }),
      NOW,
    );
    expect(r.decision).toBe("blocked_data_frozen");
  });
});
