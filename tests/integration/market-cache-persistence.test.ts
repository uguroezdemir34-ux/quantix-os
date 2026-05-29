/**
 * MARKET UTILS + MACRO CACHE + TRAIL PERSISTENCE + PREFLIGHT TESTS
 *
 * classifyFundingRate: 5 tier, tüm boundary değerleri (0.01%/0.005% eşikleri)
 *
 * interpretOiPriceAction: 5 senaryo (strong_up/weak_up/strong_down/weak_down/neutral),
 *   threshold boundary değerleri
 * describeOiSignal: 5 sinyal için label/tone doğrulaması
 *
 * cacheGet/cacheSet: TTL geçmemiş→değer, TTL geçmiş→null, key yok→null
 * cacheClear: tüm kayıtları siler
 * cacheSize: boyut takibi
 *
 * trailKey: demo/prod format
 * migrateOldTrailKey: eski key→yeni, zaten migrate→false, yoksa false,
 *   bozuk storage→false (sessiz)
 * saveTrails: boş trails, bozuk storage→false
 * loadTrails: boş storage, bozuk JSON→boş, yon eksik kayıt→atla
 *
 * runPreflightChecks: 4 kontrol sırası, tüm fail kararları, passed=true
 */

import { describe, it, expect, beforeEach } from "vitest";
import { classifyFundingRate } from "@/lib/market/fundingRate";
import {
  interpretOiPriceAction,
  describeOiSignal,
} from "@/lib/market/openInterest";
import {
  cacheGet,
  cacheSet,
  cacheClear,
  cacheSize,
} from "@/lib/macro/cache";
import {
  trailKey,
  migrateOldTrailKey,
  saveTrails,
  loadTrails,
} from "@/lib/trailing/persistence";
import {
  runPreflightChecks,
} from "@/lib/orchestrator/preflight";
import type { OrchestrateInput, AccountStateSnapshot } from "@/lib/orchestrator/types";
import type { ScoreResult } from "@/lib/score/orchestrator";

// ─────────────────────────────────────────────────────────────
// classifyFundingRate
// ─────────────────────────────────────────────────────────────

describe("classifyFundingRate()", () => {
  it(">= 0.01% → extreme_long", () => {
    expect(classifyFundingRate(0.0001)).toBe("extreme_long");
    expect(classifyFundingRate(0.0005)).toBe("extreme_long");
  });

  it("0.005-0.01% → elevated_long", () => {
    expect(classifyFundingRate(0.00005)).toBe("elevated_long");
    expect(classifyFundingRate(0.00008)).toBe("elevated_long");
  });

  it("-0.005 to +0.005% → neutral", () => {
    expect(classifyFundingRate(0)).toBe("neutral");
    expect(classifyFundingRate(0.00004)).toBe("neutral");
    expect(classifyFundingRate(-0.00004)).toBe("neutral");
  });

  it("-0.005 to -0.01% → elevated_short", () => {
    expect(classifyFundingRate(-0.00005)).toBe("elevated_short");
    expect(classifyFundingRate(-0.00008)).toBe("elevated_short");
  });

  it("<= -0.01% → extreme_short", () => {
    expect(classifyFundingRate(-0.0001)).toBe("extreme_short");
    expect(classifyFundingRate(-0.001)).toBe("extreme_short");
  });

  it("tam eşik = 0.0001 → extreme_long (>= koşulu)", () => {
    expect(classifyFundingRate(0.0001)).toBe("extreme_long");
  });

  it("tam eşik = 0.00005 → elevated_long", () => {
    expect(classifyFundingRate(0.00005)).toBe("elevated_long");
  });
});

// ─────────────────────────────────────────────────────────────
// interpretOiPriceAction
// ─────────────────────────────────────────────────────────────

describe("interpretOiPriceAction()", () => {
  it("fiyat yukarı + OI yukarı → strong_up", () => {
    expect(interpretOiPriceAction(0.5, 0.5)).toBe("strong_up");
  });

  it("fiyat yukarı + OI aşağı → weak_up (short squeeze)", () => {
    expect(interpretOiPriceAction(0.5, -0.5)).toBe("weak_up");
  });

  it("fiyat aşağı + OI yukarı → strong_down", () => {
    expect(interpretOiPriceAction(-0.5, 0.5)).toBe("strong_down");
  });

  it("fiyat aşağı + OI aşağı → weak_down (long kapanışı)", () => {
    expect(interpretOiPriceAction(-0.5, -0.5)).toBe("weak_down");
  });

  it("küçük değişim → neutral", () => {
    expect(interpretOiPriceAction(0.05, 0.1)).toBe("neutral");
  });

  it("fiyat threshold = 0.1% (eşit) → değişim anlamlı değil", () => {
    // priceUp = priceChangePct > 0.1 → 0.1 > 0.1 = false → neutral
    expect(interpretOiPriceAction(0.1, 0.5)).toBe("neutral");
  });

  it("OI threshold = 0.2% (eşit) → OI anlamlı değil", () => {
    // oiUp = oiChangePct > 0.2 → 0.2 > 0.2 = false
    expect(interpretOiPriceAction(0.5, 0.2)).toBe("neutral");
  });
});

describe("describeOiSignal()", () => {
  it("strong_up → bull", () => {
    const r = describeOiSignal("strong_up");
    expect(r.tone).toBe("bull");
    expect(r.label.length).toBeGreaterThan(0);
  });

  it("weak_up → neutral tone", () => {
    expect(describeOiSignal("weak_up").tone).toBe("neutral");
  });

  it("strong_down → bear", () => {
    expect(describeOiSignal("strong_down").tone).toBe("bear");
  });

  it("weak_down → neutral tone", () => {
    expect(describeOiSignal("weak_down").tone).toBe("neutral");
  });

  it("neutral → neutral tone", () => {
    expect(describeOiSignal("neutral").tone).toBe("neutral");
  });
});

// ─────────────────────────────────────────────────────────────
// Macro cache
// ─────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

describe("macro cache", () => {
  beforeEach(() => cacheClear());

  it("key yok → null", () => {
    expect(cacheGet("x", NOW)).toBeNull();
  });

  it("set → get döner", () => {
    cacheSet("k", { data: 42 }, NOW, 60_000);
    expect(cacheGet("k", NOW)).toEqual({ data: 42 });
  });

  it("TTL geçti → null, key silinir", () => {
    cacheSet("k", "val", NOW, 1000);
    expect(cacheGet("k", NOW + 1001)).toBeNull();
    expect(cacheSize()).toBe(0);
  });

  it("TTL tam eşit → null (expiresAt <= now)", () => {
    cacheSet("k", "val", NOW, 1000);
    // expiresAt = NOW + 1000; now = NOW + 1000 → now <= expiresAt → süresi dolmuş
    expect(cacheGet("k", NOW + 1000)).toBeNull();
  });

  it("TTL geçmedi → değer döner", () => {
    cacheSet("k", "val", NOW, 10_000);
    expect(cacheGet("k", NOW + 5_000)).toBe("val");
  });

  it("cacheClear → tüm kayıtlar silinir", () => {
    cacheSet("a", 1, NOW, 60_000);
    cacheSet("b", 2, NOW, 60_000);
    cacheClear();
    expect(cacheSize()).toBe(0);
    expect(cacheGet("a", NOW)).toBeNull();
  });

  it("cacheSize → doğru boyut", () => {
    expect(cacheSize()).toBe(0);
    cacheSet("a", 1, NOW, 60_000);
    expect(cacheSize()).toBe(1);
    cacheSet("b", 2, NOW, 60_000);
    expect(cacheSize()).toBe(2);
  });

  it("aynı key üzerine yazma → güncellenir", () => {
    cacheSet("k", "old", NOW, 60_000);
    cacheSet("k", "new", NOW, 60_000);
    expect(cacheGet("k", NOW)).toBe("new");
    expect(cacheSize()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// trailKey
// ─────────────────────────────────────────────────────────────

describe("trailKey()", () => {
  it("prod mode", () => {
    expect(trailKey(false)).toBe("ug52_trails_prod");
  });

  it("demo mode", () => {
    expect(trailKey(true)).toBe("ug52_trails_demo");
  });
});

// ─────────────────────────────────────────────────────────────
// migrateOldTrailKey
// ─────────────────────────────────────────────────────────────

describe("migrateOldTrailKey()", () => {
  function makeStorage(initial: Record<string, string> = {}) {
    const store = { ...initial };
    return {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      _store: store,
    };
  }

  it("eski key var, yeni yok → migrate eder, true döner", () => {
    const s = makeStorage({ ug52_trails: '{"BTC":{}}' });
    const r = migrateOldTrailKey(s);
    expect(r).toBe(true);
    expect(s._store["ug52_trails_prod"]).toBe('{"BTC":{}}');
    expect(s._store["ug52_trails"]).toBeUndefined();
  });

  it("eski key yok → false", () => {
    const s = makeStorage();
    expect(migrateOldTrailKey(s)).toBe(false);
  });

  it("zaten migrate edilmiş (prod key var) → false", () => {
    const s = makeStorage({
      ug52_trails: '{"BTC":{}}',
      ug52_trails_prod: '{"ETH":{}}',
    });
    expect(migrateOldTrailKey(s)).toBe(false);
    expect(s._store["ug52_trails"]).toBeDefined(); // silinmedi
  });

  it("storage hata → false (sessiz)", () => {
    const broken = {
      getItem: () => { throw new Error("storage error"); },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(migrateOldTrailKey(broken)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// saveTrails / loadTrails
// ─────────────────────────────────────────────────────────────

describe("saveTrails()", () => {
  it("boş trails → storage'a yazar, true döner", () => {
    const store: Record<string, string> = {};
    const s = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    };
    const r = saveTrails({}, s, false);
    expect(r).toBe(true);
    expect(store["ug52_trails_prod"]).toBe("{}");
  });

  it("bozuk storage → false döner", () => {
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
    };
    expect(saveTrails({}, broken, false)).toBe(false);
  });
});

describe("loadTrails()", () => {
  function makeStorage(data: Record<string, string> = {}) {
    return {
      getItem: (k: string) => data[k] ?? null,
      setItem: () => {},
    };
  }

  it("boş storage → boş obje", () => {
    const r = loadTrails(makeStorage(), false);
    expect(Object.keys(r)).toHaveLength(0);
  });

  it("bozuk JSON → boş obje (sessiz)", () => {
    const r = loadTrails(makeStorage({ ug52_trails_prod: "BOZUK{{{" }), false);
    expect(Object.keys(r)).toHaveLength(0);
  });

  it("yon eksik kayıt → atlanır", () => {
    const data = JSON.stringify({ "BTC-USDT-SWAP": { aktif_stop: null } }); // yon yok
    const r = loadTrails(makeStorage({ ug52_trails_prod: data }), false);
    expect(Object.keys(r)).toHaveLength(0);
  });

  it("demo=true → demo key kullanır", () => {
    const store: Record<string, string> = {};
    store["ug52_trails_demo"] = JSON.stringify({
      "BTC-USDT-SWAP": { yon: "LONG", en_iyi_fiyat: null, aktif_stop: null, cikis_tetiklendi: false },
    });
    const r = loadTrails(makeStorage(store), true);
    expect("BTC-USDT-SWAP" in r).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// runPreflightChecks
// ─────────────────────────────────────────────────────────────

const BASE_NOW = 1_700_000_000_000;

function makeSignal(verdict: "go" | "wait" | "no" = "go"): ScoreResult {
  return { verdict, direction: "LONG", score: 82, total: 82, effectiveThreshold: 80 } as ScoreResult;
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
    qty: 0.1,
    stopPrice: 49000,
    leverage: 10,
    marginMode: "isolated",
    source: "manual",
    accountState: makeAccount(),
    ...overrides,
  };
}

describe("runPreflightChecks()", () => {
  it("tüm kontroller geçer → passed=true, decision=executed", () => {
    const r = runPreflightChecks(makeInput(), BASE_NOW);
    expect(r.passed).toBe(true);
    expect(r.decision).toBe("executed");
  });

  it("verdict !== go → blocked_verdict", () => {
    const r = runPreflightChecks(makeInput({ signal: makeSignal("wait") }), BASE_NOW);
    expect(r.passed).toBe(false);
    expect(r.decision).toBe("blocked_verdict");
    expect(r.reasonHuman).toContain("wait");
  });

  it("verdict=no → blocked_verdict", () => {
    const r = runPreflightChecks(makeInput({ signal: makeSignal("no") }), BASE_NOW);
    expect(r.decision).toBe("blocked_verdict");
  });

  it("drawdown locked → blocked_drawdown", () => {
    const r = runPreflightChecks(
      makeInput({ accountState: makeAccount({ drawdownProtocol: { tier: "locked", multiplier: 0, label: "Kilitli" } }) }),
      BASE_NOW,
    );
    expect(r.decision).toBe("blocked_drawdown");
    expect(r.passed).toBe(false);
  });

  it("BTC cooldown aktif + alt pair → blocked_lock", () => {
    const r = runPreflightChecks(
      makeInput({
        pair: "ETH",
        accountState: makeAccount({ btcCooldownUntil: BASE_NOW + 60_000 }),
      }),
      BASE_NOW,
    );
    expect(r.decision).toBe("blocked_lock");
    expect(r.reasonHuman).toContain("ETH");
  });

  it("BTC cooldown aktif + BTC pair → geçer (BTC cooldown ETH için)", () => {
    const r = runPreflightChecks(
      makeInput({
        pair: "BTC",
        accountState: makeAccount({ btcCooldownUntil: BASE_NOW + 60_000 }),
      }),
      BASE_NOW,
    );
    // BTC cooldown sadece alt pair'leri etkiler → BTC geçer
    expect(r.passed).toBe(true);
  });

  it("BTC self cooldown aktif + BTC pair → blocked_lock", () => {
    const r = runPreflightChecks(
      makeInput({
        pair: "BTC",
        accountState: makeAccount({ btcSelfCooldownUntil: BASE_NOW + 30_000 }),
      }),
      BASE_NOW,
    );
    expect(r.decision).toBe("blocked_lock");
  });

  it("todayTradeCount >= maxTradesPerDay → blocked_daily_limit", () => {
    const r = runPreflightChecks(
      makeInput({ accountState: makeAccount({ todayTradeCount: 2, maxTradesPerDay: 2 }) }),
      BASE_NOW,
    );
    expect(r.decision).toBe("blocked_daily_limit");
    expect(r.reasonHuman).toContain("2/2");
  });

  it("sıralama: verdict en önce (verdict fail + drawdown locked → verdict kazanır)", () => {
    const r = runPreflightChecks(
      makeInput({
        signal: makeSignal("wait"),
        accountState: makeAccount({ drawdownProtocol: { tier: "locked", multiplier: 0, label: "Kilitli" } }),
      }),
      BASE_NOW,
    );
    expect(r.decision).toBe("blocked_verdict");
  });

  it("sıralama: drawdown önce verdict'ten sonra (verdict go + locked → blocked_drawdown)", () => {
    const r = runPreflightChecks(
      makeInput({
        accountState: makeAccount({
          drawdownProtocol: { tier: "locked", multiplier: 0, label: "Kilitli" },
          btcCooldownUntil: BASE_NOW + 60_000,
        }),
        pair: "ETH",
      }),
      BASE_NOW,
    );
    expect(r.decision).toBe("blocked_drawdown");
  });
});
