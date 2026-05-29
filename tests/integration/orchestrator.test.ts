import { describe, it, expect, vi, beforeEach } from "vitest";
import { orchestrate } from "@/lib/orchestrator/router";
import { InMemoryDedupeStore } from "@/lib/orchestrator/dedupe";
import { buildDedupeKey } from "@/lib/orchestrator/types";
import type {
  OrchestrateInput,
  OrchestratorDeps,
  AccountStateSnapshot,
} from "@/lib/orchestrator/types";
import type { ScoreResult } from "@/lib/score/orchestrator";
import type { AdapterResult, TradeData } from "@/lib/exchange/types";


// ─── Factories ───

function makeScoreResult(overrides?: Partial<ScoreResult>): ScoreResult {
  return {
    pair: "BTC",
    score: 82,
    baseScore: 80,
    total: 82,
    verdict: "go",
    direction: "LONG",
    dirConfidence: 2,
    counterTrend: false,
    sub: {
      trend: 15,
      adx: 10,
      rsi: 10,
      vol: 10,
      bb: 10,
      vwap: 10,
      funding: 5,
      macro: 10,
    },
    reasons: {
      trend: "uptrend",
      adx: "strong",
      rsi: "neutral",
      vol: "high",
      bb: "ok",
      vwap: "above",
      funding: "low",
      macro: "bullish",
    },
    blocks: [],
    softBlocks: [],
    sweepBonus: 0,
    regimeBonus: 2,
    regime: "trending_strong",
    goThreshold: 80,
    bucket: {
      n: 0,
      wr: null,
      isCut: false,
      isBoost: false,
      hasData: false,
      min: 80,
      max: 89,
    },
    srModifier: 0,
    atrRegimeAdj: 0,
    volBreakoutActive: false,
    signalType: null,
    pullbackActive: false,
    pullbackThreshold: 80,
    effectiveThreshold: 80,
    overextFlags: 0,
    ...overrides,
  } as ScoreResult;
}

function makeAccountState(overrides?: Partial<AccountStateSnapshot>): AccountStateSnapshot {
  return {
    drawdownProtocol: { tier: "normal", multiplier: 1, label: "Normal" },
    btcCooldownUntil: 0,
    btcSelfCooldownUntil: 0,
    todayTradeCount: 0,
    maxTradesPerDay: 2,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<OrchestrateInput>): OrchestrateInput {
  return {
    signal: makeScoreResult(),
    pair: "BTC",
    livePrice: 50000,
    qty: 0.01,
    stopPrice: 49000,
    leverage: 5,
    marginMode: "cross",
    source: "bot",
    accountState: makeAccountState(),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  const adapter = {
    openPosition: vi.fn<[], Promise<AdapterResult<TradeData>>>().mockResolvedValue({ ok: true, data: { orderId: "test-123" } }),
    closePosition: vi.fn(),
    cancelAlgoOrders: vi.fn(),
  };
  return {
    adapter,
    channels: [],
    dedupeStore: new InMemoryDedupeStore(),
    now: 1_700_000_000_000,
    ...overrides,
  };
}

// ─── Tests ───

describe("orchestrate()", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("1. happy path — executes trade successfully", async () => {
    const result = await orchestrate(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.decision).toBe("executed");
    expect(deps.adapter.openPosition).toHaveBeenCalledOnce();
    expect(result.journalEntry.type).toBe("trade_open");
  });

  it("2. blocked_verdict — verdict 'wait' blocks execution", async () => {
    const input = makeInput({ signal: makeScoreResult({ verdict: "wait" }) });
    const result = await orchestrate(input, deps);
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("blocked_verdict");
    expect(deps.adapter.openPosition).not.toHaveBeenCalled();
  });

  it("3. blocked_drawdown — locked tier blocks execution", async () => {
    const input = makeInput({
      accountState: makeAccountState({
        drawdownProtocol: { tier: "locked", multiplier: 0, label: "Locked" },
      }),
    });
    const result = await orchestrate(input, deps);
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("blocked_drawdown");
  });

  it("4. blocked_lock — btcCooldownUntil > now for ETH pair", async () => {
    const now = 1_700_000_000_000;
    const input = makeInput({
      pair: "ETH",
      accountState: makeAccountState({ btcCooldownUntil: now + 60000 }),
    });
    const result = await orchestrate(input, { ...deps, now });
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("blocked_lock");
  });

  it("5. blocked_daily_limit — todayTradeCount >= maxTradesPerDay", async () => {
    const input = makeInput({
      accountState: makeAccountState({ todayTradeCount: 2, maxTradesPerDay: 2 }),
    });
    const result = await orchestrate(input, deps);
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("blocked_daily_limit");
  });

  it("6. blocked_dedup — pre-recorded key returns duplicate", async () => {
    const now = 1_700_000_000_000;
    const localDeps = makeDeps({ now });
    const key = buildDedupeKey("BTC", "LONG", now);
    localDeps.dedupeStore.record(key, now);
    const result = await orchestrate(makeInput(), localDeps);
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("blocked_dedup");
  });

  it("7. failed_exchange — adapter returns ok:false, decision:'failed_exchange', notifyResults empty", async () => {
    const failingAdapter = {
      openPosition: vi.fn<[], Promise<AdapterResult<TradeData>>>().mockResolvedValue({
        ok: false,
        errorKind: "rate_limit",
        errorMessage: "Too many requests",
      }),
      closePosition: vi.fn(),
      cancelAlgoOrders: vi.fn(),
    };
    const result = await orchestrate(makeInput(), { ...deps, adapter: failingAdapter });
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("failed_exchange");
    expect(result.notifyResults).toEqual([]);
  });

  it("8. notify failure doesn't fail trade — channel throws, ok:true, notifyResults[0].ok===false", async () => {
    const throwingChannel = {
      name: "telegram" as const,
      isImplemented: true,
      isConfigured: () => true,
      send: vi.fn().mockRejectedValue(new Error("Telegram unreachable")),
    };
    const result = await orchestrate(makeInput(), { ...deps, channels: [throwingChannel] });
    expect(result.ok).toBe(true);
    expect(result.notifyResults[0].ok).toBe(false);
  });
});
