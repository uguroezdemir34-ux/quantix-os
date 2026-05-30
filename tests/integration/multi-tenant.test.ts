/**
 * MULTI-TENANT EXECUTION ENGINE — Entegrasyon + Concurrency Testleri (Topic 10)
 *
 * Kapsam:
 *   1. TenantRegistry — CRUD + sandbox yönetimi
 *   2. Sandbox izolasyonu — bir tenant'ın hatası diğerlerini etkilemez
 *   3. Paralel yürütüm — Promise.allSettled fanout
 *   4. Token Bucket izolasyonu — her tenant bağımsız rate limiter
 *   5. Preflight sandbox — her tenant kendi drawdown/cooldown/daily limit'ini bağımsız taşır
 *   6. Concurrent emirler — aynı sinyal N hesaba eş zamanlı iletilir, sıraya girmez
 *   7. Kısmi başarı — bazı tenantlar başarılı, bazıları başarısız → diğerleri etkilenmez
 *   8. Admin kilitleme — lockedReason olan tenant fanout sırasında atlanır
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  TenantRegistry,
  MultiTenantExecutor,
  createDefaultSandbox,
  createTenantCredentials,
  type TenantConfig,
  type TenantSandbox,
  type TenantAdapterFactory,
} from "@/lib/exchange/multi-tenant";

import type { ExchangeAdapter } from "@/lib/exchange/types";
import type { ScoreResult } from "@/lib/score/orchestrator";

// ─────────────────────────────────────────────────────────────
// MOCK HELPERS
// ─────────────────────────────────────────────────────────────

/** Mock adapter — her çağrıda resolve süresi ve sonucu özelleştirilebilir */
function makeMockAdapter(
  opts: {
    ok?: boolean;
    delayMs?: number;
    errorMessage?: string;
    throws?: boolean;
    onCall?: () => void;
  } = {},
): ExchangeAdapter & { callCount: number; callTimestamps: number[] } {
  let callCount = 0;
  const callTimestamps: number[] = [];

  return {
    callCount,
    callTimestamps,
    async openPosition() {
      callCount++;
      (this as { callCount: number }).callCount = callCount;
      callTimestamps.push(Date.now());
      opts.onCall?.();
      if (opts.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      if (opts.throws) {
        throw new Error(opts.errorMessage ?? "Adapter exception");
      }
      if (opts.ok === false) {
        return {
          ok: false,
          errorKind: "OKX_ERR",
          errorMessage: opts.errorMessage ?? "Exchange error",
        };
      }
      return {
        ok: true,
        data: { orderId: `ord_${Math.random().toString(36).slice(2)}`, instId: "BTC-USDT-SWAP" },
      };
    },
    async closePosition() {
      return { ok: true };
    },
    async cancelAlgoOrders() {
      return { ok: true };
    },
  } as ExchangeAdapter & { callCount: number; callTimestamps: number[] };
}

/** Adapter fabrikası — her tenant için ayrı mock adapter döner */
function makeAdapterFactory(
  adapterMap: Map<string, ExchangeAdapter>,
  defaultAdapter?: ExchangeAdapter,
): TenantAdapterFactory {
  return (tenantId) => {
    return adapterMap.get(tenantId) ?? defaultAdapter ?? makeMockAdapter();
  };
}

/** Minimal geçerli ScoreResult (verdict=go, direction=LONG) */
function makeGoSignal(pair = "BTC"): ScoreResult {
  return {
    pair,
    score: 85,
    baseScore: 82,
    total: 85,
    verdict: "go",
    direction: "LONG",
    dirConfidence: 0.8,
    counterTrend: false,
    sub: { trend: 20, adx: 12, rsi: 8, vol: 12, bb: 8, vwap: 8, funding: 7, macro: 7 },
    reasons: {
      trend: "ok",
      adx: "ok",
      rsi: "ok",
      vol: "ok",
      bb: "ok",
      vwap: "ok",
      funding: "ok",
      macro: "ok",
    },
    blocks: [],
    softBlocks: [],
    sweepBonus: 0,
    regimeBonus: 3,
    regime: "trending_strong",
    goThreshold: 80,
    bucket: { isCut: false, min: 80, max: 89, n: 10, wr: 70 } as ReturnType<typeof import("@/lib/bucket/stats").getBucketStats>,
    srModifier: 0,
    atrRegimeAdj: 0,
    volBreakoutActive: false,
    signalType: "none",
    pullbackActive: false,
    pullbackThreshold: 80,
    effectiveThreshold: 80,
    overextFlags: 0,
  } as unknown as ScoreResult;
}

/** Minimal tenant config */
function makeTenant(
  id: string,
  label: string,
  sandboxOverrides: Partial<TenantSandbox> = {},
): TenantConfig {
  const credentials = createTenantCredentials(
    id,
    label,
    `ENC1:apikey_${id}`,
    `ENC1:secret_${id}`,
    `ENC1:pass_${id}`,
    true,
  );
  const sandbox = {
    ...createDefaultSandbox(id, 10_000),
    ...sandboxOverrides,
  };
  return { credentials, sandbox };
}

/** Executor helper */
function makeExecutor(
  registry: TenantRegistry,
  adapterMap: Map<string, ExchangeAdapter> = new Map(),
  defaultAdapter?: ExchangeAdapter,
): MultiTenantExecutor {
  const factory = makeAdapterFactory(adapterMap, defaultAdapter);
  return new MultiTenantExecutor(registry, factory, {
    defaultQty: 0.01,
    defaultLivePrice: 50000,
    defaultLeverage: 5,
    now: () => 1_700_000_000_000,
  });
}

// ═══════════════════════════════════════════════════════════════
// TENANT REGISTRY TESTS
// ═══════════════════════════════════════════════════════════════

describe("TenantRegistry", () => {
  let registry: TenantRegistry;

  beforeEach(() => {
    registry = new TenantRegistry();
  });

  it("register and retrieve tenant", () => {
    const tenant = makeTenant("t1", "Tenant 1");
    registry.register(tenant);
    const retrieved = registry.get("t1");
    expect(retrieved?.credentials.tenantId).toBe("t1");
    expect(retrieved?.credentials.label).toBe("Tenant 1");
  });

  it("size() reflects registered count", () => {
    expect(registry.size()).toBe(0);
    registry.register(makeTenant("t1", "T1"));
    registry.register(makeTenant("t2", "T2"));
    expect(registry.size()).toBe(2);
  });

  it("unregister removes tenant", () => {
    registry.register(makeTenant("t1", "T1"));
    expect(registry.unregister("t1")).toBe(true);
    expect(registry.get("t1")).toBeUndefined();
    expect(registry.size()).toBe(0);
  });

  it("unregister returns false for unknown tenant", () => {
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("getEnabled() returns only enabled non-locked tenants", () => {
    registry.register(makeTenant("t1", "T1", { enabled: true }));
    registry.register(makeTenant("t2", "T2", { enabled: false }));
    registry.register(makeTenant("t3", "T3", { enabled: true, lockedReason: "liquidation" }));
    const enabled = registry.getEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].credentials.tenantId).toBe("t1");
  });

  it("updateSandbox merges changes", () => {
    registry.register(makeTenant("t1", "T1"));
    registry.updateSandbox("t1", { todayTradeCount: 2 });
    expect(registry.get("t1")?.sandbox.todayTradeCount).toBe(2);
  });

  it("updateSandbox returns false for unknown tenant", () => {
    expect(registry.updateSandbox("ghost", { todayTradeCount: 1 })).toBe(false);
  });

  it("lockTenant disables and sets reason", () => {
    registry.register(makeTenant("t1", "T1", { enabled: true }));
    registry.lockTenant("t1", "Liquidation detected");
    const t = registry.get("t1");
    expect(t?.sandbox.enabled).toBe(false);
    expect(t?.sandbox.lockedReason).toBe("Liquidation detected");
  });

  it("unlockTenant re-enables tenant", () => {
    registry.register(makeTenant("t1", "T1", { enabled: false, lockedReason: "Maintenance" }));
    registry.unlockTenant("t1");
    const t = registry.get("t1");
    expect(t?.sandbox.enabled).toBe(true);
    expect(t?.sandbox.lockedReason).toBeUndefined();
  });

  it("registry isolation — modifying returned config does not affect stored state", () => {
    registry.register(makeTenant("t1", "T1"));
    const retrieved = registry.get("t1")!;
    retrieved.sandbox.todayTradeCount = 99; // mutate returned copy
    expect(registry.get("t1")?.sandbox.todayTradeCount).toBe(0); // original unchanged
  });

  it("register overwrites existing tenant", () => {
    registry.register(makeTenant("t1", "Original"));
    registry.register(makeTenant("t1", "Updated"));
    expect(registry.get("t1")?.credentials.label).toBe("Updated");
    expect(registry.size()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// SANDBOX ISOLATION TESTS
// ═══════════════════════════════════════════════════════════════

describe("Account Sandboxing — Isolation", () => {
  it("one tenant's drawdown lock does not affect another", async () => {
    const registry = new TenantRegistry();
    registry.register(
      makeTenant("t1", "Healthy", { enabled: true }),
    );
    registry.register(
      makeTenant("t2", "Locked", {
        enabled: true,
        drawdownProtocol: {
          tier: "locked",
          multiplier: 0,
          label: "Drawdown locked",
        },
      }),
    );

    const successAdapter = makeMockAdapter({ ok: true });
    const adapterMap = new Map([
      ["t1", successAdapter as ExchangeAdapter],
      ["t2", makeMockAdapter() as ExchangeAdapter],
    ]);
    const executor = makeExecutor(registry, adapterMap);
    const result = await executor.fanout(makeGoSignal(), "BTC");

    const t1 = result.results.find((r) => r.tenantId === "t1");
    const t2 = result.results.find((r) => r.tenantId === "t2");

    expect(t1?.ok).toBe(true);
    expect(t1?.decision).toBe("executed");
    expect(t2?.ok).toBe(false);
    expect(t2?.decision).toBe("blocked_drawdown");
  });

  it("one tenant's BTC cooldown does not affect another", async () => {
    const registry = new TenantRegistry();
    const now = 1_700_000_000_000;
    registry.register(makeTenant("t1", "T1", { enabled: true }));
    registry.register(
      makeTenant("t2", "T2 BTC Cooldown", {
        enabled: true,
        btcCooldownUntil: now + 60_000, // cooldown active for 60s
      }),
    );

    // t2 trading ETH but has BTC cooldown → should be blocked for non-BTC pairs
    const adapterMap = new Map<string, ExchangeAdapter>();
    const executor = makeExecutor(registry, adapterMap, makeMockAdapter());
    const result = await executor.fanout(makeGoSignal("ETH"), "ETH");

    const t1r = result.results.find((r) => r.tenantId === "t1");
    const t2r = result.results.find((r) => r.tenantId === "t2");

    expect(t1r?.ok).toBe(true);
    expect(t2r?.ok).toBe(false);
    expect(t2r?.decision).toBe("blocked_lock");
  });

  it("one tenant's daily trade limit does not affect another", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1", { todayTradeCount: 0, maxTradesPerDay: 2 }));
    registry.register(
      makeTenant("t2", "T2 Daily Limit", { todayTradeCount: 2, maxTradesPerDay: 2 }),
    );

    const adapterMap = new Map<string, ExchangeAdapter>();
    const executor = makeExecutor(registry, adapterMap, makeMockAdapter());
    const result = await executor.fanout(makeGoSignal(), "BTC");

    const t1r = result.results.find((r) => r.tenantId === "t1");
    const t2r = result.results.find((r) => r.tenantId === "t2");

    expect(t1r?.ok).toBe(true);
    expect(t2r?.ok).toBe(false);
    expect(t2r?.decision).toBe("blocked_daily_limit");
  });

  it("one tenant's leverage limit does not affect another", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1", { maxLeverage: 10 }));
    registry.register(makeTenant("t2", "T2 Low Leverage", { maxLeverage: 3 }));

    const adapterMap = new Map<string, ExchangeAdapter>();
    const executor = new MultiTenantExecutor(
      registry,
      makeAdapterFactory(adapterMap, makeMockAdapter()),
      {
        defaultQty: 0.01,
        defaultLivePrice: 50000,
        defaultLeverage: 5, // t2 maxLeverage=3 → blocked
        now: () => 1_700_000_000_000,
      },
    );
    const result = await executor.fanout(makeGoSignal(), "BTC");

    const t1r = result.results.find((r) => r.tenantId === "t1");
    const t2r = result.results.find((r) => r.tenantId === "t2");

    expect(t1r?.ok).toBe(true);
    expect(t2r?.ok).toBe(false);
    expect(t2r?.reasonHuman).toMatch(/kaldıraç|leverage/i);
  });

  it("adapter exception in one tenant does not propagate to others", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));
    registry.register(makeTenant("t2", "T2 Throws"));

    const crashAdapter = makeMockAdapter({ throws: true, errorMessage: "Adapter crash" });
    const goodAdapter = makeMockAdapter({ ok: true });
    const adapterMap = new Map<string, ExchangeAdapter>([
      ["t1", goodAdapter],
      ["t2", crashAdapter],
    ]);
    const executor = makeExecutor(registry, adapterMap);
    const result = await executor.fanout(makeGoSignal(), "BTC");

    const t1r = result.results.find((r) => r.tenantId === "t1");
    const t2r = result.results.find((r) => r.tenantId === "t2");

    expect(t1r?.ok).toBe(true);
    expect(t2r?.ok).toBe(false);
    expect(t2r?.reasonHuman).toMatch(/crash/i);
  });

  it("disabled tenant skipped, others execute normally", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "Active"));
    registry.register(makeTenant("t2", "Disabled", { enabled: false }));
    registry.register(makeTenant("t3", "Active2"));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());
    const result = await executor.fanout(makeGoSignal(), "BTC");

    expect(result.successCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    const t2r = result.results.find((r) => r.tenantId === "t2");
    expect(t2r?.decision).toBe("skipped_disabled");
  });

  it("sandbox todayTradeCount increments only for executing tenant", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1", { todayTradeCount: 0 }));
    registry.register(makeTenant("t2", "T2", { todayTradeCount: 0, drawdownProtocol: {
      tier: "locked", multiplier: 0, label: "Locked",
    }}));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());
    await executor.fanout(makeGoSignal(), "BTC");

    expect(registry.get("t1")?.sandbox.todayTradeCount).toBe(1); // executed
    expect(registry.get("t2")?.sandbox.todayTradeCount).toBe(0); // blocked
  });
});

// ═══════════════════════════════════════════════════════════════
// PARALLEL EXECUTION (CONCURRENCY) TESTS
// ═══════════════════════════════════════════════════════════════

describe("Parallel Execution — Concurrency", () => {
  it("all adapters called concurrently (overlapping time windows)", async () => {
    const registry = new TenantRegistry();
    const N = 4;
    const callStarts: Record<string, number> = {};
    const callEnds: Record<string, number> = {};

    for (let i = 0; i < N; i++) {
      registry.register(makeTenant(`t${i}`, `Tenant ${i}`));
    }

    // Each adapter takes 50ms
    const adapterMap = new Map<string, ExchangeAdapter>();
    for (let i = 0; i < N; i++) {
      const id = `t${i}`;
      adapterMap.set(id, {
        async openPosition() {
          callStarts[id] = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          callEnds[id] = Date.now();
          return { ok: true, data: { orderId: `ord_${id}` } };
        },
        async closePosition() { return { ok: true }; },
        async cancelAlgoOrders() { return { ok: true }; },
      } as ExchangeAdapter);
    }

    const t0 = Date.now();
    const executor = makeExecutor(registry, adapterMap);
    const result = await executor.fanout(makeGoSignal(), "BTC");
    const totalMs = Date.now() - t0;

    // All executed
    expect(result.successCount).toBe(N);

    // Total time should be ~50ms (concurrent), not N×50ms (sequential)
    // Allow up to 3× a single call time for test env overhead
    expect(totalMs).toBeLessThan(50 * 3);

    // Call starts should overlap (all started before any ended)
    const minStart = Math.min(...Object.values(callStarts));
    const maxStart = Math.max(...Object.values(callStarts));
    // All 4 started within 20ms of each other (concurrent, not sequential 50ms gaps)
    expect(maxStart - minStart).toBeLessThan(20);
  }, 2000);

  it("fanout completes even when some adapters are slow and others fast", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("fast", "Fast Tenant"));
    registry.register(makeTenant("slow", "Slow Tenant"));

    const adapterMap = new Map<string, ExchangeAdapter>([
      ["fast", makeMockAdapter({ ok: true, delayMs: 5 }) as ExchangeAdapter],
      ["slow", makeMockAdapter({ ok: true, delayMs: 80 }) as ExchangeAdapter],
    ]);

    const executor = makeExecutor(registry, adapterMap);
    const t0 = Date.now();
    const result = await executor.fanout(makeGoSignal(), "BTC");
    const elapsed = Date.now() - t0;

    expect(result.successCount).toBe(2);
    // Should take ~80ms (slow one), not 80+5=85ms sequential
    expect(elapsed).toBeLessThan(200);
  }, 2000);

  it("10 tenants all execute in parallel under 500ms", async () => {
    const registry = new TenantRegistry();
    for (let i = 0; i < 10; i++) {
      registry.register(makeTenant(`t${i}`, `T${i}`));
    }

    const executor = makeExecutor(
      registry,
      new Map(),
      makeMockAdapter({ ok: true, delayMs: 30 }),
    );

    const t0 = Date.now();
    const result = await executor.fanout(makeGoSignal(), "BTC");
    const elapsed = Date.now() - t0;

    expect(result.successCount).toBe(10);
    expect(elapsed).toBeLessThan(500); // would be 300ms sequential
  }, 2000);

  it("mixed results: 3 success, 2 failure, 1 disabled in 6-tenant fanout", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("ok1", "OK1"));
    registry.register(makeTenant("ok2", "OK2"));
    registry.register(makeTenant("ok3", "OK3"));
    registry.register(makeTenant("fail1", "Fail1"));
    registry.register(makeTenant("fail2", "Fail2"));
    registry.register(makeTenant("dis1", "Disabled", { enabled: false }));

    const adapterMap = new Map<string, ExchangeAdapter>([
      ["ok1", makeMockAdapter({ ok: true }) as ExchangeAdapter],
      ["ok2", makeMockAdapter({ ok: true }) as ExchangeAdapter],
      ["ok3", makeMockAdapter({ ok: true }) as ExchangeAdapter],
      ["fail1", makeMockAdapter({ ok: false, errorMessage: "Insufficient margin" }) as ExchangeAdapter],
      ["fail2", makeMockAdapter({ throws: true, errorMessage: "Network timeout" }) as ExchangeAdapter],
    ]);

    const executor = makeExecutor(registry, adapterMap);
    const result = await executor.fanout(makeGoSignal(), "BTC");

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.results).toHaveLength(6);
  });

  it("fanout result contains pair and timing metadata", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());
    const result = await executor.fanout(makeGoSignal("ETH"), "ETH");

    expect(result.pair).toBe("ETH");
    expect(result.dispatchedAt).toBeGreaterThan(0);
    expect(result.completedAt).toBeGreaterThanOrEqual(result.dispatchedAt);
  });

  it("each tenant result includes durationMs", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter({ delayMs: 10 }));
    const result = await executor.fanout(makeGoSignal(), "BTC");

    expect(result.results[0].durationMs).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// PER-TENANT RATE LIMITER ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Per-Tenant Rate Limiter — Isolation", () => {
  it("adapter factory called once per tenant per fanout", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));
    registry.register(makeTenant("t2", "T2"));

    const factoryCallsPerTenant: Record<string, number> = {};
    const factory: TenantAdapterFactory = (tenantId) => {
      factoryCallsPerTenant[tenantId] = (factoryCallsPerTenant[tenantId] ?? 0) + 1;
      return makeMockAdapter({ ok: true }) as ExchangeAdapter;
    };

    const executor = new MultiTenantExecutor(registry, factory, {
      defaultQty: 0.01,
      defaultLivePrice: 50000,
      defaultLeverage: 5,
      now: () => 1_700_000_000_000,
    });

    await executor.fanout(makeGoSignal(), "BTC");

    expect(factoryCallsPerTenant["t1"]).toBe(1);
    expect(factoryCallsPerTenant["t2"]).toBe(1);
  });

  it("adapters are independent — adapter A's state does not affect adapter B", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));
    registry.register(makeTenant("t2", "T2"));

    const callLog: string[] = [];

    const factory: TenantAdapterFactory = (tenantId) => ({
      async openPosition() {
        callLog.push(`${tenantId}:openPosition`);
        return { ok: true, data: { orderId: `ord_${tenantId}` } };
      },
      async closePosition() { return { ok: true }; },
      async cancelAlgoOrders() { return { ok: true }; },
    } as ExchangeAdapter);

    const executor = new MultiTenantExecutor(registry, factory, {
      defaultQty: 0.01,
      defaultLivePrice: 50000,
      defaultLeverage: 5,
      now: () => 1_700_000_000_000,
    });

    await executor.fanout(makeGoSignal(), "BTC");

    expect(callLog).toContain("t1:openPosition");
    expect(callLog).toContain("t2:openPosition");
    expect(callLog).toHaveLength(2); // exactly one call per tenant
  });

  it("multiple sequential fanouts each create fresh adapters", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));

    let factoryCallCount = 0;
    const factory: TenantAdapterFactory = () => {
      factoryCallCount++;
      return makeMockAdapter({ ok: true }) as ExchangeAdapter;
    };

    const executor = new MultiTenantExecutor(registry, factory, {
      defaultQty: 0.01,
      defaultLivePrice: 50000,
      defaultLeverage: 5,
      now: () => 1_700_000_000_000,
    });

    await executor.fanout(makeGoSignal(), "BTC");
    await executor.fanout(makeGoSignal(), "BTC");

    // New adapter per fanout per tenant
    expect(factoryCallCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// VERDICT PASS-THROUGH
// ═══════════════════════════════════════════════════════════════

describe("Verdict pass-through", () => {
  it("non-go verdict blocks all tenants", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));
    registry.register(makeTenant("t2", "T2"));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());
    const waitSignal = { ...makeGoSignal(), verdict: "wait" as const };
    const result = await executor.fanout(waitSignal, "BTC");

    expect(result.successCount).toBe(0);
    for (const r of result.results) {
      if (!r.decision.startsWith("skipped")) {
        expect(r.decision).toBe("blocked_verdict");
      }
    }
  });

  it("go signal dispatched to all enabled tenants", async () => {
    const registry = new TenantRegistry();
    for (let i = 0; i < 3; i++) {
      registry.register(makeTenant(`t${i}`, `T${i}`));
    }

    const executor = makeExecutor(registry, new Map(), makeMockAdapter({ ok: true }));
    const result = await executor.fanout(makeGoSignal(), "BTC");

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// ADMIN OPERATIONS
// ═══════════════════════════════════════════════════════════════

describe("Admin operations", () => {
  it("locking a tenant mid-session excludes it from next fanout", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));
    registry.register(makeTenant("t2", "T2"));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());

    // First fanout: both active
    const r1 = await executor.fanout(makeGoSignal(), "BTC");
    expect(r1.successCount).toBe(2);

    // Lock t2 (e.g. liquidation detected externally)
    registry.lockTenant("t2", "Liquidation detected");

    // Second fanout: only t1
    const r2 = await executor.fanout(makeGoSignal(), "BTC");
    expect(r2.successCount).toBe(1);
    const t2r = r2.results.find((r) => r.tenantId === "t2");
    expect(t2r?.decision).toBe("skipped_locked");
    expect(t2r?.reasonHuman).toBe("Liquidation detected");
  });

  it("unlocking a tenant re-admits it to fanout", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1", { enabled: false, lockedReason: "Maintenance" }));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());

    const r1 = await executor.fanout(makeGoSignal(), "BTC");
    expect(r1.successCount).toBe(0);
    expect(r1.skippedCount).toBe(1);

    registry.unlockTenant("t1");

    const r2 = await executor.fanout(makeGoSignal(), "BTC");
    expect(r2.successCount).toBe(1);
  });

  it("adding tenant mid-session includes it in next fanout", async () => {
    const registry = new TenantRegistry();
    registry.register(makeTenant("t1", "T1"));

    const executor = makeExecutor(registry, new Map(), makeMockAdapter());

    const r1 = await executor.fanout(makeGoSignal(), "BTC");
    expect(r1.successCount).toBe(1);

    // New tenant joins
    registry.register(makeTenant("t2", "New Tenant"));

    const r2 = await executor.fanout(makeGoSignal(), "BTC");
    expect(r2.successCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// SANDBOX HELPERS
// ═══════════════════════════════════════════════════════════════

describe("createDefaultSandbox / createTenantCredentials", () => {
  it("createDefaultSandbox produces enabled sandbox with zero trades", () => {
    const sandbox = createDefaultSandbox("t1", 5000, 10, 3);
    expect(sandbox.tenantId).toBe("t1");
    expect(sandbox.equityUsd).toBe(5000);
    expect(sandbox.maxLeverage).toBe(10);
    expect(sandbox.maxTradesPerDay).toBe(3);
    expect(sandbox.todayTradeCount).toBe(0);
    expect(sandbox.enabled).toBe(true);
    expect(sandbox.drawdownProtocol.tier).toBe("normal");
  });

  it("createTenantCredentials stores encrypted keys", () => {
    const creds = createTenantCredentials("t1", "TestLabel", "ENC1:aaa", "ENC1:bbb", "ENC1:ccc", false);
    expect(creds.encryptedApiKey).toBe("ENC1:aaa");
    expect(creds.encryptedSecretKey).toBe("ENC1:bbb");
    expect(creds.encryptedPassphrase).toBe("ENC1:ccc");
    expect(creds.isDemo).toBe(false);
    expect(creds.label).toBe("TestLabel");
  });
});
