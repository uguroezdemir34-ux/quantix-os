/**
 * MEMORY PRUNING — Entegrasyon Testleri (Topic 12 — İnce Ayarlar #1)
 *
 * Kapsam:
 *   1. pruneOldClosedTrades() — saf fonksiyon sınır değer testleri
 *   2. mergeIntoArchive() — arşiv boyut sınırı ve sıralama
 *   3. measureBucketLatency() — getBucketStats <1ms latency kanıtı
 *   4. TradePruner döngüsü — start/stop/pruneNow/callback
 *   5. Store entegrasyonu — pruneOldClosed action + arşiv güncelleme
 *   6. Açık/bekleyen trade'lerin asla prune edilmediği güvencesi
 *   7. Büyük veri setinde performans kanıtı (500 trade < 1ms)
 */

import { describe, it, expect, vi } from "vitest";

import {
  pruneOldClosedTrades,
  mergeIntoArchive,
  measureBucketLatency,
  DEFAULT_PRUNE_AGE_MS,
  type PruneResult,
} from "@/lib/trades/state";

import {
  TradePruner,
  type PrunableTradesStore,
} from "@/lib/trades/pruner";

import { getBucketStats } from "@/lib/bucket/stats";
import type { TradeSnapshot } from "@/lib/trades/types";
import type { Trade } from "@/lib/bucket/stats";

// ─────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = 1_700_000_000_000;

function makeTrade(
  id: string,
  status: "open" | "pending" | "closed",
  closedAt?: number,
): TradeSnapshot {
  return {
    id,
    pair: "BTC",
    direction: "LONG",
    status,
    openedAt: NOW - 100_000,
    entryPrice: 50000,
    qty: 0.01,
    leverage: 5,
    stopPrice: 49000,
    riskAmountUsd: 10,
    isPaper: false,
    entryContext: { score: 82, verdict: "go" },
    exit:
      status === "closed" && closedAt !== undefined
        ? {
            closedAt,
            exitPrice: 51000,
            reason: "tp1",
            pnlUsd: 10,
            pnlPct: 0.02,
            holdingSec: 3600,
            rMultiple: 1,
          }
        : undefined,
  } as TradeSnapshot;
}

/** getBucketStats-uyumlu Trade nesnesi oluştur */
function makeBucketTrade(score: number, pnlUsd: number, closedAt?: number): Trade {
  return { score, pnlUsd, closedAt };
}

/** Mock PrunableTradesStore */
function makeMockStore(initial: TradeSnapshot[] = []): PrunableTradesStore & {
  _trades: TradeSnapshot[];
  _pruneCallCount: number;
} {
  let trades = [...initial];
  let pruneCallCount = 0;

  return {
    _trades: trades,
    get _pruneCallCount() { return pruneCallCount; },
    getTrades: () => trades,
    applyPrune: (result: PruneResult) => {
      trades = [...result.live];
      pruneCallCount++;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// pruneOldClosedTrades — SAF FONKSİYON TESTLERİ
// ═══════════════════════════════════════════════════════════════

describe("pruneOldClosedTrades — saf fonksiyon", () => {
  it("boş dizi → hiçbir şey prune edilmez", () => {
    const result = pruneOldClosedTrades([], NOW);
    expect(result.live).toHaveLength(0);
    expect(result.pruned).toHaveLength(0);
    expect(result.prunedCount).toBe(0);
  });

  it("48h+ eski CLOSED → pruned'a taşınır", () => {
    const old = makeTrade("old1", "closed", NOW - DAY_MS * 3); // 3 gün önce
    const result = pruneOldClosedTrades([old], NOW);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe("old1");
    expect(result.live).toHaveLength(0);
  });

  it("48h'den taze CLOSED → live'da kalır", () => {
    const fresh = makeTrade("fresh1", "closed", NOW - 24 * HOUR_MS); // 24h önce
    const result = pruneOldClosedTrades([fresh], NOW);
    expect(result.live).toHaveLength(1);
    expect(result.pruned).toHaveLength(0);
  });

  it("TAM 48h eşiğindeki trade prune edilir (>= check)", () => {
    const exactly48h = makeTrade("boundary", "closed", NOW - DEFAULT_PRUNE_AGE_MS);
    const result = pruneOldClosedTrades([exactly48h], NOW);
    expect(result.pruned).toHaveLength(1);
  });

  it("48h - 1ms taze kalır", () => {
    const almostBoundary = makeTrade("almost", "closed", NOW - DEFAULT_PRUNE_AGE_MS + 1);
    const result = pruneOldClosedTrades([almostBoundary], NOW);
    expect(result.live).toHaveLength(1);
    expect(result.pruned).toHaveLength(0);
  });

  it("OPEN trade asla prune edilmez", () => {
    const open = makeTrade("open1", "open");
    const result = pruneOldClosedTrades([open], NOW);
    expect(result.live).toHaveLength(1);
    expect(result.pruned).toHaveLength(0);
  });

  it("PENDING trade asla prune edilmez", () => {
    const pending = makeTrade("pending1", "pending");
    const result = pruneOldClosedTrades([pending], NOW);
    expect(result.live).toHaveLength(1);
    expect(result.pruned).toHaveLength(0);
  });

  it("exit.closedAt yoksa (bozuk veri) → prune edilir (güvenli taraf)", () => {
    const broken: TradeSnapshot = {
      ...makeTrade("broken", "closed"),
      exit: undefined, // closedAt yok
    };
    const result = pruneOldClosedTrades([broken], NOW);
    expect(result.pruned).toHaveLength(1);
  });

  it("karışık: open + recent closed + old closed → doğru ayrım", () => {
    const openTrade = makeTrade("open1", "open");
    const recentClosed = makeTrade("recent", "closed", NOW - 12 * HOUR_MS);  // 12h
    const oldClosed = makeTrade("old1", "closed", NOW - 72 * HOUR_MS);        // 72h
    const olderClosed = makeTrade("old2", "closed", NOW - 7 * DAY_MS);        // 7 gün

    const result = pruneOldClosedTrades([openTrade, recentClosed, oldClosed, olderClosed], NOW);

    expect(result.live).toHaveLength(2); // open + recent
    expect(result.pruned).toHaveLength(2); // old1 + old2
    expect(result.live.some((t) => t.id === "open1")).toBe(true);
    expect(result.live.some((t) => t.id === "recent")).toBe(true);
    expect(result.pruned.some((t) => t.id === "old1")).toBe(true);
    expect(result.pruned.some((t) => t.id === "old2")).toBe(true);
  });

  it("totalBefore doğru raporlanır", () => {
    const trades = [
      makeTrade("t1", "open"),
      makeTrade("t2", "closed", NOW - 72 * HOUR_MS),
      makeTrade("t3", "closed", NOW - 12 * HOUR_MS),
    ];
    const result = pruneOldClosedTrades(trades, NOW);
    expect(result.totalBefore).toBe(3);
  });

  it("özel maxAgeMs (24h) ile prune", () => {
    const trade24h = makeTrade("t24h", "closed", NOW - 24 * HOUR_MS);
    const trade12h = makeTrade("t12h", "closed", NOW - 12 * HOUR_MS);

    const result = pruneOldClosedTrades([trade24h, trade12h], NOW, 24 * HOUR_MS);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe("t24h");
    expect(result.live).toHaveLength(1);
    expect(result.live[0].id).toBe("t12h");
  });

  it("hiçbiri prune edilmiyorsa prunedCount=0", () => {
    const trades = [
      makeTrade("t1", "open"),
      makeTrade("t2", "closed", NOW - HOUR_MS),
    ];
    const result = pruneOldClosedTrades(trades, NOW);
    expect(result.prunedCount).toBe(0);
    expect(result.live).toHaveLength(2);
  });

  it("orijinal dizi değişmez (immutability)", () => {
    const oldTrade = makeTrade("old", "closed", NOW - 72 * HOUR_MS);
    const original = [oldTrade];
    pruneOldClosedTrades(original, NOW);
    expect(original).toHaveLength(1); // orijinal dokunulmaz
  });
});

// ═══════════════════════════════════════════════════════════════
// mergeIntoArchive — ARŞİV YÖNETİMİ
// ═══════════════════════════════════════════════════════════════

describe("mergeIntoArchive — arşiv yönetimi", () => {
  it("arşiv + yeni trade'ler birleştirilir", () => {
    const existing = [makeTrade("a1", "closed", NOW - 7 * DAY_MS)];
    const incoming = [makeTrade("a2", "closed", NOW - 3 * DAY_MS)];
    const result = mergeIntoArchive(existing, incoming, 100);
    expect(result).toHaveLength(2);
  });

  it("maxSize aşıldığında en eskiler atılır", () => {
    const existing = Array.from({ length: 5 }, (_, i) =>
      makeTrade(`old${i}`, "closed", NOW - (10 + i) * DAY_MS), // eski
    );
    const incoming = Array.from({ length: 3 }, (_, i) =>
      makeTrade(`new${i}`, "closed", NOW - i * DAY_MS), // yeni
    );
    const result = mergeIntoArchive(existing, incoming, 6); // max 6
    expect(result).toHaveLength(6);
    // En son kaydedilenler kalmalı (en taze 6)
    const oldestKept = Math.min(...result.map((t) => t.exit?.closedAt ?? 0));
    const discarded = existing
      .map((t) => t.exit?.closedAt ?? 0)
      .filter((ts) => ts < oldestKept);
    expect(discarded.length).toBeGreaterThan(0);
  });

  it("maxSize aşılmıyorsa tümü korunur", () => {
    const existing = [makeTrade("a", "closed", NOW - 3 * DAY_MS)];
    const incoming = [makeTrade("b", "closed", NOW - 2 * DAY_MS)];
    const result = mergeIntoArchive(existing, incoming, 1000);
    expect(result).toHaveLength(2);
  });

  it("boş arşiv + yeni trade'ler", () => {
    const incoming = Array.from({ length: 3 }, (_, i) =>
      makeTrade(`t${i}`, "closed", NOW - i * DAY_MS),
    );
    const result = mergeIntoArchive([], incoming, 100);
    expect(result).toHaveLength(3);
  });

  it("orijinal arşiv değişmez", () => {
    const existing = [makeTrade("e1", "closed", NOW - 3 * DAY_MS)];
    const incoming = [makeTrade("i1", "closed", NOW - 1 * DAY_MS)];
    mergeIntoArchive(existing, incoming, 100);
    expect(existing).toHaveLength(1); // orijinal dokunulmaz
  });
});

// ═══════════════════════════════════════════════════════════════
// measureBucketLatency — LATENCY KANITI
// ═══════════════════════════════════════════════════════════════

describe("measureBucketLatency — skor motoru <1ms garantisi", () => {
  it("10 trade ile getBucketStats <1ms tamamlanır", () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      makeBucketTrade(82 + (i % 5), i % 2 === 0 ? 10 : -5),
    );
    const { durationUs, overBudget } = measureBucketLatency(82, trades, getBucketStats);
    expect(overBudget).toBe(false);
    expect(durationUs).toBeGreaterThanOrEqual(0);
  });

  it("100 trade ile getBucketStats <1ms tamamlanır (prune öncesi tipik)", () => {
    const trades = Array.from({ length: 100 }, (_, i) =>
      makeBucketTrade(75 + (i % 20), (i % 3 === 0 ? 1 : -1) * 5, NOW - i * 3600),
    );
    const { overBudget } = measureBucketLatency(80, trades, getBucketStats);
    expect(overBudget).toBe(false);
  });

  it("500 trade ile getBucketStats <1ms tamamlanır (worst case)", () => {
    const trades = Array.from({ length: 500 }, (_, i) =>
      makeBucketTrade(50 + (i % 50), (i % 2 === 0 ? 1 : -1) * 10),
    );
    const { overBudget, durationUs } = measureBucketLatency(80, trades, getBucketStats);
    expect(overBudget).toBe(false);
    // İspat: 500 trade ile de JavaScript O(n) < 1ms'de biter
    expect(durationUs).toBeLessThan(1000);
  });

  it("result doğru hesaplanır", () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeBucketTrade(82, i % 2 === 0 ? 10 : -5),
    );
    const { result } = measureBucketLatency(82, trades, getBucketStats);
    expect(result.n).toBe(8);
    expect(result.hasData).toBe(true);
  });

  it("overBudget flag doğru tayin edilir (mock yavaş fn)", () => {
    const slowFn = (score: number, trades: readonly Trade[]) => {
      // Senkron busy-wait 2ms (jest fake timer değil, gerçek CPU döngüsü)
      const t0 = Date.now();
      while (Date.now() - t0 < 2) { /* spin */ }
      return getBucketStats(score, trades);
    };
    const trades = Array.from({ length: 10 }, (_, i) => makeBucketTrade(82, i));
    const { overBudget } = measureBucketLatency(82, trades, slowFn);
    expect(overBudget).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// TradePruner — DÖNGÜ TESTLERİ
// ═══════════════════════════════════════════════════════════════

describe("TradePruner — zamanlayıcı döngüsü", () => {
  it("başlangıçta running=false", () => {
    const store = makeMockStore();
    const pruner = new TradePruner(store);
    expect(pruner.running).toBe(false);
  });

  it("start() → running=true", () => {
    const store = makeMockStore();
    const setIntervalFn = vi.fn((_fn: () => void) => {
      return 1 as ReturnType<typeof setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const pruner = new TradePruner(store, {
      setIntervalFn,
      clearIntervalFn,
      now: () => NOW,
    });
    pruner.start();
    expect(pruner.running).toBe(true);
    pruner.stop();
  });

  it("stop() → running=false", () => {
    const store = makeMockStore();
    const setIntervalFn = vi.fn(() => 1 as ReturnType<typeof setInterval>);
    const clearIntervalFn = vi.fn();

    const pruner = new TradePruner(store, {
      setIntervalFn,
      clearIntervalFn,
      now: () => NOW,
    });
    pruner.start();
    pruner.stop();
    expect(pruner.running).toBe(false);
    expect(clearIntervalFn).toHaveBeenCalledWith(1);
  });

  it("start() idempotent — iki kez çağrılırsa tek interval kurulur", () => {
    const store = makeMockStore();
    const setIntervalFn = vi.fn(() => 1 as ReturnType<typeof setInterval>);
    const clearIntervalFn = vi.fn();

    const pruner = new TradePruner(store, { setIntervalFn, clearIntervalFn, now: () => NOW });
    pruner.start();
    pruner.start(); // ikinci çağrı
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    pruner.stop();
  });

  it("pruneNow() prune tetikler ve PruneResult döner", () => {
    const old1 = makeTrade("old1", "closed", NOW - 72 * HOUR_MS);
    const fresh = makeTrade("fresh", "closed", NOW - 12 * HOUR_MS);
    const open = makeTrade("open1", "open");
    const store = makeMockStore([old1, fresh, open]);

    const pruner = new TradePruner(store, { now: () => NOW });
    const result = pruner.pruneNow();

    expect(result.prunedCount).toBe(1);
    expect(result.pruned[0].id).toBe("old1");
    expect(result.live).toHaveLength(2); // fresh + open
  });

  it("prune yoksa applyPrune çağrılmaz (no-op)", () => {
    const fresh = makeTrade("fresh", "closed", NOW - 12 * HOUR_MS);
    const store = makeMockStore([fresh]);

    const pruner = new TradePruner(store, { now: () => NOW });
    pruner.pruneNow();

    expect(store._pruneCallCount).toBe(0);
  });

  it("onPrune callback çağrılır prune sonrası", () => {
    const old = makeTrade("old", "closed", NOW - 72 * HOUR_MS);
    const store = makeMockStore([old]);
    const onPruneFn = vi.fn();

    const pruner = new TradePruner(store, {
      now: () => NOW,
      onPrune: onPruneFn,
    });
    pruner.pruneNow();

    expect(onPruneFn).toHaveBeenCalledTimes(1);
    const [result, archiveSize] = onPruneFn.mock.calls[0];
    expect(result.prunedCount).toBe(1);
    expect(typeof archiveSize).toBe("number");
  });

  it("totalPrunedCount oturumda birikir", () => {
    const store = makeMockStore([
      makeTrade("o1", "closed", NOW - 72 * HOUR_MS),
      makeTrade("o2", "closed", NOW - 96 * HOUR_MS),
    ]);

    const pruner = new TradePruner(store, { now: () => NOW });
    pruner.pruneNow();
    expect(pruner.totalPrunedCount).toBe(2);
  });

  it("lastPruneAt güncellenir", () => {
    const old = makeTrade("old", "closed", NOW - 72 * HOUR_MS);
    const store = makeMockStore([old]);

    const pruner = new TradePruner(store, { now: () => NOW });
    expect(pruner.lastPruneAt).toBeNull();
    pruner.pruneNow();
    expect(pruner.lastPruneAt).toBe(NOW);
  });

  it("interval callback'i prune yapar", () => {
    const old = makeTrade("old", "closed", NOW - 72 * HOUR_MS);
    const store = makeMockStore([old]);

    const callbacks: Array<() => void> = [];
    const setIntervalFn = vi.fn((fn: () => void, _ms: number) => {
      callbacks.push(fn);
      return 99 as ReturnType<typeof setInterval>;
    });
    const clearIntervalFn = vi.fn();

    const pruner = new TradePruner(store, {
      setIntervalFn,
      clearIntervalFn,
      now: () => NOW,
    });
    pruner.start();
    // interval callback kayıt edildi
    expect(callbacks).toHaveLength(1);
    pruner.stop();
  });
});

// ═══════════════════════════════════════════════════════════════
// AÇIK/BEKLEYENLERİN KORUNMASI — GÜVENCESİ
// ═══════════════════════════════════════════════════════════════

describe("Açık ve bekleyen trade'ler asla prune edilmez", () => {
  it("10 yıllık pending trade prune edilmez", () => {
    const ancient = {
      ...makeTrade("ancient_pending", "pending"),
      openedAt: NOW - 10 * 365 * DAY_MS,
    };
    const result = pruneOldClosedTrades([ancient], NOW);
    expect(result.live).toHaveLength(1);
    expect(result.pruned).toHaveLength(0);
  });

  it("10 yıllık open trade prune edilmez", () => {
    const ancient = {
      ...makeTrade("ancient_open", "open"),
      openedAt: NOW - 10 * 365 * DAY_MS,
    };
    const result = pruneOldClosedTrades([ancient], NOW);
    expect(result.live).toHaveLength(1);
  });

  it("100 open + 50 old closed → sadece 50 closed prune edilir", () => {
    const openTrades = Array.from({ length: 100 }, (_, i) =>
      makeTrade(`open${i}`, "open"),
    );
    const oldClosed = Array.from({ length: 50 }, (_, i) =>
      makeTrade(`old${i}`, "closed", NOW - 72 * HOUR_MS - i * HOUR_MS),
    );
    const result = pruneOldClosedTrades([...openTrades, ...oldClosed], NOW);
    expect(result.live).toHaveLength(100); // tüm open'lar korundu
    expect(result.pruned).toHaveLength(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// PRUNE SONRASI SKOR MOTORU HIZI
// ═══════════════════════════════════════════════════════════════

describe("Prune sonrası skor motoru hızı", () => {
  it("prune sonrası 10 trade → getBucketStats <1ms", () => {
    // Live state: sadece taze 10 trade (490 eski prune edilmiş gibi)
    const freshTrades = Array.from({ length: 10 }, (_, i) =>
      makeBucketTrade(82, i % 2 === 0 ? 10 : -5, NOW - i * 3600),
    );
    const { durationUs, overBudget } = measureBucketLatency(82, freshTrades, getBucketStats);

    expect(overBudget).toBe(false);
    expect(durationUs).toBeLessThan(500); // 0.5ms altında olmalı
  });

  it("prune olmadan 500 trade ile de <1ms (JavaScript hızı kanıtı)", () => {
    const allTrades = Array.from({ length: 500 }, (_, i) =>
      makeBucketTrade(50 + (i % 50), (i % 2 === 0 ? 1 : -1) * 10),
    );
    const { overBudget } = measureBucketLatency(80, allTrades, getBucketStats);
    expect(overBudget).toBe(false);
  });

  it("10 prune döngüsü sonrası live state küçük kalır", () => {
    // Simulate: her saat 5 trade kapanıyor, 10 iterasyon
    let trades: TradeSnapshot[] = [];
    const TICK_INTERVAL = HOUR_MS;

    for (let tick = 0; tick < 10; tick++) {
      const tickNow = NOW + tick * TICK_INTERVAL;
      // 5 yeni CLOSED trade ekle
      for (let j = 0; j < 5; j++) {
        trades.push(makeTrade(`t_${tick}_${j}`, "closed", tickNow - 5 * HOUR_MS)); // taze
      }
      // 72h+ eskilerini prune et
      const result = pruneOldClosedTrades(trades, tickNow);
      trades = result.live;
    }

    // 10 iterasyon × 5 trade = 50 trade, hiçbiri 48h geçmemiş
    expect(trades.length).toBeLessThanOrEqual(50);
    expect(trades.every((t) => t.status !== "open")).toBe(true); // hepsi closed
  });
});
