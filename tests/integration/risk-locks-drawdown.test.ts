/**
 * RISK LOCKS + DRAWDOWN + BTC COOLDOWN TESTS
 *
 * getDrawdownProtocol: 4 tier, tüm sınır değerleri, NaN/Infinity guard
 *
 * computeActiveLocks: drawdown locked, btc_cooldown (alt pair), btc_self_cooldown (BTC),
 *   lock_ramp (24h window), kombinasyonlar, remainingSec doğrulaması
 * isHardBlocked: account_locked/btc_cooldown/btc_self_cooldown → true; lock_ramp → false
 * formatLockDuration: sn/dk/saat formatları, sıfır guard
 *
 * evaluateBtcMovement: 3 eşik, ilk eşleşen kazanır (öncelik sırası), boundary değerleri
 * BtcCooldown.applyMovement: altUntil/selfUntil set + yenileme (max), persist
 * BtcCooldown.checkBlock: BTC→selfUntil, alt→altUntil, süresi dolmuş→null
 * BtcCooldown.reset: state temizle
 * Storage: load round-trip, bozuk JSON sessiz çıkış
 *
 * DailyLossLock.update: tier geçişleri, event callback'leri, tek seferlik tetikleme
 * DailyLossLock.reset: durumu sıfırla
 */

import { describe, it, expect, vi } from "vitest";
import {
  getDrawdownProtocol,
} from "@/lib/risk/drawdown-protocol";
import {
  computeActiveLocks,
  isHardBlocked,
  formatLockDuration,
  type LockState,
} from "@/lib/risk/locks";
import {
  evaluateBtcMovement,
  BtcCooldown,
  BTC_COOLDOWN_CONSTANTS,
} from "@/lib/risk/btc-cooldown";
import { DailyLossLock } from "@/lib/risk/daily-loss-lock";
import type { DrawdownProtocol } from "@/lib/store/accountStore";
// Note: lib/store/accountStore DrawdownProtocol = { tier, multiplier, label }
// lib/risk/drawdown-protocol DrawdownProtocol = { tier, multiplier, minScore, label, reason }
// locks.ts uses accountStore's version — so our test helpers match that shape

// ─────────────────────────────────────────────────────────────
// getDrawdownProtocol
// ─────────────────────────────────────────────────────────────

describe("getDrawdownProtocol()", () => {
  it("> -1.5% → normal", () => {
    const r = getDrawdownProtocol(0);
    expect(r.tier).toBe("normal");
    expect(r.multiplier).toBe(1.0);
    expect(r.minScore).toBe(80);
  });

  it("-1.5% (eşit) → caution", () => {
    const r = getDrawdownProtocol(-1.5);
    expect(r.tier).toBe("caution");
    expect(r.multiplier).toBe(0.5);
    expect(r.minScore).toBe(80);
  });

  it("-1.5% ile -2.5% arası → caution", () => {
    const r = getDrawdownProtocol(-2.0);
    expect(r.tier).toBe("caution");
  });

  it("-2.5% (eşit) → restricted", () => {
    const r = getDrawdownProtocol(-2.5);
    expect(r.tier).toBe("restricted");
    expect(r.multiplier).toBe(0.25);
    expect(r.minScore).toBe(85);
  });

  it("-3.0% (eşit) → locked", () => {
    const r = getDrawdownProtocol(-3.0);
    expect(r.tier).toBe("locked");
    expect(r.multiplier).toBe(0);
    expect(r.minScore).toBe(100);
  });

  it("< -3.0% → locked", () => {
    expect(getDrawdownProtocol(-5.0).tier).toBe("locked");
  });

  it("NaN → normal (guard)", () => {
    expect(getDrawdownProtocol(NaN).tier).toBe("normal");
  });

  it("Infinity → normal (guard)", () => {
    expect(getDrawdownProtocol(Infinity).tier).toBe("normal");
  });

  it("label boş değil", () => {
    ["normal", "caution", "restricted", "locked"].forEach((_, pnl) => {
      const r = getDrawdownProtocol(-pnl);
      expect(r.label.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// computeActiveLocks
// ─────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

const normalProtocol: DrawdownProtocol = {
  tier: "normal",
  multiplier: 1,
  label: "Normal",
};

const lockedProtocol: DrawdownProtocol = {
  tier: "locked",
  multiplier: 0,
  label: "Locked",
};

function makeState(overrides: Partial<LockState> = {}): LockState {
  return {
    btcCooldownUntil: 0,
    btcCooldownReason: "",
    btcSelfCooldownUntil: 0,
    lockReleasedAt: 0,
    drawdownProtocol: normalProtocol,
    ...overrides,
  };
}

describe("computeActiveLocks()", () => {
  it("aktif kilit yok → boş dizi", () => {
    const r = computeActiveLocks(makeState(), NOW, "BTC");
    expect(r).toHaveLength(0);
  });

  it("drawdown locked → account_locked eklenir", () => {
    const r = computeActiveLocks(makeState({ drawdownProtocol: lockedProtocol }), NOW, "BTC");
    expect(r.some((l) => l.kind === "account_locked")).toBe(true);
  });

  it("btcCooldownUntil > now + alt pair → btc_cooldown eklenir", () => {
    const r = computeActiveLocks(
      makeState({ btcCooldownUntil: NOW + 60_000, btcCooldownReason: "spike" }),
      NOW,
      "ETH",
    );
    const lock = r.find((l) => l.kind === "btc_cooldown");
    expect(lock).toBeDefined();
    expect(lock!.remainingSec).toBe(60);
    expect(lock!.reason).toBe("spike");
  });

  it("btcCooldownUntil > now + BTC pair → btc_cooldown eklenmez (BTC için değil)", () => {
    const r = computeActiveLocks(
      makeState({ btcCooldownUntil: NOW + 60_000 }),
      NOW,
      "BTC",
    );
    expect(r.some((l) => l.kind === "btc_cooldown")).toBe(false);
  });

  it("btcSelfCooldownUntil > now + BTC pair → btc_self_cooldown eklenir", () => {
    const r = computeActiveLocks(
      makeState({ btcSelfCooldownUntil: NOW + 30_000 }),
      NOW,
      "BTC",
    );
    const lock = r.find((l) => l.kind === "btc_self_cooldown");
    expect(lock).toBeDefined();
    expect(lock!.remainingSec).toBe(30);
  });

  it("btcSelfCooldownUntil > now + ETH pair → btc_self_cooldown eklenmez", () => {
    const r = computeActiveLocks(
      makeState({ btcSelfCooldownUntil: NOW + 30_000 }),
      NOW,
      "ETH",
    );
    expect(r.some((l) => l.kind === "btc_self_cooldown")).toBe(false);
  });

  it("lockReleasedAt + 24h içinde → lock_ramp eklenir", () => {
    const releasedAt = NOW - 2 * 60 * 60 * 1000; // 2 saat önce serbest bırakıldı
    const r = computeActiveLocks(makeState({ lockReleasedAt: releasedAt }), NOW, "BTC");
    const lock = r.find((l) => l.kind === "lock_ramp");
    expect(lock).toBeDefined();
    expect(lock!.remainingSec).toBeGreaterThan(0);
  });

  it("lockReleasedAt + tam 24h → lock_ramp YOK (elapsed >= LOCK_RAMP_MS)", () => {
    const releasedAt = NOW - 24 * 60 * 60 * 1000; // tam 24h önce
    const r = computeActiveLocks(makeState({ lockReleasedAt: releasedAt }), NOW, "BTC");
    expect(r.some((l) => l.kind === "lock_ramp")).toBe(false);
  });

  it("lockReleasedAt = 0 → lock_ramp yok", () => {
    const r = computeActiveLocks(makeState({ lockReleasedAt: 0 }), NOW, "BTC");
    expect(r.some((l) => l.kind === "lock_ramp")).toBe(false);
  });

  it("birden fazla lock aynı anda — hepsi listede", () => {
    const r = computeActiveLocks(
      makeState({
        drawdownProtocol: lockedProtocol,
        btcCooldownUntil: NOW + 60_000,
        lockReleasedAt: NOW - 1000,
      }),
      NOW,
      "ETH",
    );
    expect(r.length).toBeGreaterThanOrEqual(3);
  });
});

describe("isHardBlocked()", () => {
  it("boş dizi → false", () => {
    expect(isHardBlocked([])).toBe(false);
  });

  it("account_locked → true", () => {
    expect(isHardBlocked([{ kind: "account_locked", until: null }])).toBe(true);
  });

  it("btc_cooldown → true", () => {
    expect(isHardBlocked([{ kind: "btc_cooldown", until: NOW + 1 }])).toBe(true);
  });

  it("btc_self_cooldown → true", () => {
    expect(isHardBlocked([{ kind: "btc_self_cooldown", until: NOW + 1 }])).toBe(true);
  });

  it("lock_ramp tek başına → false (soft)", () => {
    expect(isHardBlocked([{ kind: "lock_ramp", until: NOW + 1 }])).toBe(false);
  });
});

describe("formatLockDuration()", () => {
  it("0 → '0s'", () => {
    expect(formatLockDuration(0)).toBe("0s");
  });

  it("negatif → '0s'", () => {
    expect(formatLockDuration(-10)).toBe("0s");
  });

  it("45s → '45s'", () => {
    expect(formatLockDuration(45)).toBe("45s");
  });

  it("90s → '1m 30s'", () => {
    expect(formatLockDuration(90)).toBe("1m 30s");
  });

  it("3600s → '1h 0m'", () => {
    expect(formatLockDuration(3600)).toBe("1h 0m");
  });

  it("5400s (1.5h) → '1h 30m'", () => {
    expect(formatLockDuration(5400)).toBe("1h 30m");
  });

  it("60s → '1m 0s'", () => {
    expect(formatLockDuration(60)).toBe("1m 0s");
  });
});

// ─────────────────────────────────────────────────────────────
// evaluateBtcMovement (saf fonksiyon)
// ─────────────────────────────────────────────────────────────

describe("evaluateBtcMovement()", () => {
  it("tüm eşiklerin altında → triggered=false", () => {
    const r = evaluateBtcMovement({ lastClosePct: 1.0, lastRangePct: 1.0, last4hPct: 1.0 });
    expect(r.triggered).toBe(false);
  });

  it("1H kapanış > 2.0% → triggered (ilk koşul)", () => {
    const r = evaluateBtcMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 });
    expect(r.triggered).toBe(true);
    expect(r.reason).toContain("kapanış");
  });

  it("1H kapanış = 2.0% (boundary eşit) → triggered=false (> koşulu)", () => {
    const r = evaluateBtcMovement({ lastClosePct: 2.0, lastRangePct: 0, last4hPct: 0 });
    expect(r.triggered).toBe(false);
  });

  it("1H range > 2.5% → triggered (ikinci koşul)", () => {
    const r = evaluateBtcMovement({ lastClosePct: 1.0, lastRangePct: 2.6, last4hPct: 0 });
    expect(r.triggered).toBe(true);
    expect(r.reason).toContain("intra-bar");
  });

  it("4H değişim > 3.0% → triggered (üçüncü koşul)", () => {
    const r = evaluateBtcMovement({ lastClosePct: 1.0, lastRangePct: 1.0, last4hPct: 3.1 });
    expect(r.triggered).toBe(true);
    expect(r.reason).toContain("4H");
  });

  it("öncelik: 1H kapanış > range > 4H (ilk eşleşen kazanır)", () => {
    // tüm eşikler aşıldı
    const r = evaluateBtcMovement({ lastClosePct: 2.1, lastRangePct: 2.6, last4hPct: 3.1 });
    expect(r.reason).toContain("kapanış"); // ilk koşul
  });
});

// ─────────────────────────────────────────────────────────────
// BtcCooldown class
// ─────────────────────────────────────────────────────────────

describe("BtcCooldown.applyMovement()", () => {
  it("tetiklenmiyor → state değişmez", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 1.0, lastRangePct: 1.0, last4hPct: 1.0 }, NOW);
    expect(cd.getState().altUntil).toBe(0);
    expect(cd.getState().selfUntil).toBe(0);
  });

  it("tetiklenince altUntil = now + 60dk", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    expect(cd.getState().altUntil).toBe(NOW + BTC_COOLDOWN_CONSTANTS.ALT_COOLDOWN_MS);
  });

  it("tetiklenince selfUntil = now + 30dk", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    expect(cd.getState().selfUntil).toBe(NOW + BTC_COOLDOWN_CONSTANTS.SELF_COOLDOWN_MS);
  });

  it("yenileme: tekrar tetiklenince süre uzar (max alınır)", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    const firstUntil = cd.getState().altUntil;
    // 30 dk sonra tekrar tetikle
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW + 30 * 60_000);
    expect(cd.getState().altUntil).toBeGreaterThanOrEqual(firstUntil);
  });
});

describe("BtcCooldown.checkBlock()", () => {
  it("cooldown yokken → null döner", () => {
    const cd = new BtcCooldown();
    expect(cd.checkBlock("ETH", NOW)).toBeNull();
    expect(cd.checkBlock("BTC", NOW)).toBeNull();
  });

  it("ETH → altUntil kontrol eder, aktifse block döner", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    const block = cd.checkBlock("ETH", NOW + 1000);
    expect(block).not.toBeNull();
    expect(block!.remainMin).toBeGreaterThan(0);
  });

  it("BTC → selfUntil kontrol eder", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    const block = cd.checkBlock("BTC", NOW + 1000);
    expect(block).not.toBeNull();
  });

  it("süre dolmuşsa → null döner", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    // 70 dk sonrası — alt cooldown (60dk) dolmuş
    expect(cd.checkBlock("ETH", NOW + 70 * 60_000)).toBeNull();
  });
});

describe("BtcCooldown storage", () => {
  it("reset() state'i sıfırlar", () => {
    const cd = new BtcCooldown();
    cd.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    cd.reset();
    expect(cd.getState().altUntil).toBe(0);
    expect(cd.getState().selfUntil).toBe(0);
    expect(cd.checkBlock("ETH", NOW)).toBeNull();
  });

  it("StorageLike mock — persist + load round-trip", () => {
    const store: Record<string, string> = {};
    const storageMock = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    };
    const cd1 = new BtcCooldown(storageMock);
    cd1.applyMovement({ lastClosePct: 2.1, lastRangePct: 0, last4hPct: 0 }, NOW);
    const saved = cd1.getState();

    // Yeni instance → LS'den yükler
    const cd2 = new BtcCooldown(storageMock);
    expect(cd2.getState().altUntil).toBe(saved.altUntil);
    expect(cd2.getState().selfUntil).toBe(saved.selfUntil);
  });

  it("bozuk JSON → sessiz çıkış, state varsayılan kalır", () => {
    const storageMock = {
      getItem: () => "BOZUK{{{",
      setItem: (_k: string, _v: string) => {},
    };
    const cd = new BtcCooldown(storageMock);
    expect(cd.getState().altUntil).toBe(0); // varsayılan
  });
});

// ─────────────────────────────────────────────────────────────
// DailyLossLock
// ─────────────────────────────────────────────────────────────

describe("DailyLossLock", () => {
  it("başlangıçta normal tier, locked=false", () => {
    const dll = new DailyLossLock();
    expect(dll.getProtocol().tier).toBe("normal");
    expect(dll.isLocked()).toBe(false);
  });

  it("update(-2.0) → caution", () => {
    const dll = new DailyLossLock();
    const p = dll.update(-2.0);
    expect(p.tier).toBe("caution");
  });

  it("update(-3.0) → locked=true", () => {
    const dll = new DailyLossLock();
    dll.update(-3.0);
    expect(dll.isLocked()).toBe(true);
    expect(dll.getLockReason()).toContain("kayıp");
  });

  it("onLocked callback yalnızca bir kez çağrılır", () => {
    const cb = vi.fn();
    const dll = new DailyLossLock({ onLocked: cb });
    dll.update(-3.0);
    dll.update(-3.5); // tekrar locked
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("onTierChange caution'a ilk geçişte tetiklenir", () => {
    const cb = vi.fn();
    const dll = new DailyLossLock({ onTierChange: cb });
    dll.update(-2.0); // normal → caution
    expect(cb).toHaveBeenCalledWith("caution", expect.any(Object));
  });

  it("onTierChange aynı tier'da tekrar tetiklenmez", () => {
    const cb = vi.fn();
    const dll = new DailyLossLock({ onTierChange: cb });
    dll.update(-2.0); // normal → caution
    dll.update(-2.2); // caution → caution (değişmedi)
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("onTierChange locked geçişinde tetiklenmez (onLocked'ın görev alanı)", () => {
    const tierCb = vi.fn();
    const lockCb = vi.fn();
    const dll = new DailyLossLock({ onTierChange: tierCb, onLocked: lockCb });
    dll.update(-3.0);
    expect(lockCb).toHaveBeenCalledTimes(1);
    expect(tierCb).not.toHaveBeenCalled(); // locked hariç tutulur
  });

  it("reset() → normal, locked=false", () => {
    const dll = new DailyLossLock();
    dll.update(-3.5);
    dll.reset();
    expect(dll.isLocked()).toBe(false);
    expect(dll.getProtocol().tier).toBe("normal");
    expect(dll.getLockReason()).toBeNull();
  });

  it("reset sonrası update(-3.0) → onLocked tekrar tetiklenebilir", () => {
    const cb = vi.fn();
    const dll = new DailyLossLock({ onLocked: cb });
    dll.update(-3.0);
    dll.reset();
    dll.update(-3.0);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
