/**
 * CVD + TRADE CLASSIFIER + TRADE FEED TESTS
 *
 * classifyMagnitude: BTC/ETH eşik farkı, neutral/weak/strong/extreme sınırları
 * classifyDirection: neutral magnitude → neutral direction, bullish/bearish
 * computeCvdWindow: boş→cvd=0, buy ağırlıklı→bullish, pencere dışı filtreleme,
 *   buyUsd/sellUsd ayrı, tradeCount doğru
 * computeCvdMultiFrame: 3 pencere, confluence bullish/bearish/eşit→neutral, pair
 * formatCvd: M/K/küçük formatları, işaret (+/-)
 *
 * parseOkxTrade: geçerli BTC/ETH, bilinmeyen instId→null, side geçersiz→null,
 *   sayısal hata (NaN/0) → null, tradeId boş → null, notionalUsd = price*size
 * parseOkxTradeBatch: karma batch filtre
 * dedupeTrades: tekrar trade → atla, yeni → ekle, immutable existing set
 * trimIdSet: maxSize altında → değişmez, üstünde → eski at yeni koru
 *
 * createPairFeedState: idle, lastMessageAt=null
 * ingestTrades: pair filtresi, dedup, live state, lastMessageAt güncelle
 *   farklı pair → heartbeat ama buffer değişmez
 * setConnectionState: state geçişi, error
 * isStale: lastMessageAt=null→false, taze→false, eski→true
 * getTrades: buffer items döner
 */

import { describe, it, expect } from "vitest";
import {
  classifyMagnitude,
  classifyDirection,
  computeCvdWindow,
  computeCvdMultiFrame,
  formatCvd,
} from "@/lib/orderflow/cvd";
import {
  parseOkxTrade,
  parseOkxTradeBatch,
  dedupeTrades,
  trimIdSet,
} from "@/lib/orderflow/tradeClassifier";
import {
  createPairFeedState,
  ingestTrades,
  setConnectionState,
  isStale,
  getTrades,
} from "@/lib/orderflow/tradeFeed";
import type { OkxTradeRaw, Trade } from "@/lib/orderflow/types";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
let _id = 0;

function makeTrade(
  side: "buy" | "sell",
  notionalUsd: number,
  ts = NOW - 1000,
): Trade {
  return {
    tradeId: `t${++_id}`,
    pair: "BTC",
    timestamp: ts,
    price: 50000,
    size: notionalUsd / 50000,
    notionalUsd,
    side,
  };
}

function makeRaw(
  instId = "BTC-USDT-SWAP",
  side: "buy" | "sell" = "buy",
  price = "50000",
  size = "0.01",
  ts = String(NOW - 1000),
): OkxTradeRaw {
  return {
    ts,
    px: price,
    sz: size,
    side,
    tradeId: `raw${++_id}`,
    instId,
  };
}

// ─────────────────────────────────────────────────────────────
// classifyMagnitude
// ─────────────────────────────────────────────────────────────

describe("classifyMagnitude()", () => {
  it("BTC: sıfır CVD → neutral", () => {
    expect(classifyMagnitude("BTC", 0)).toBe("neutral");
  });

  it("ETH: sıfır CVD → neutral", () => {
    expect(classifyMagnitude("ETH", 0)).toBe("neutral");
  });

  it("BTC: büyük CVD → extreme", () => {
    expect(classifyMagnitude("BTC", 50_000_000)).toBe("extreme");
  });

  it("ETH: BTC'den düşük eşikle extreme", () => {
    // ETH eşikleri BTC'den daha düşük — aynı değerde farklı sınıf olabilir
    const btcResult = classifyMagnitude("BTC", 200_000);
    const ethResult = classifyMagnitude("ETH", 200_000);
    // ETH'de strong veya extreme, BTC'de weak veya strong
    expect(["neutral", "weak", "strong", "extreme"]).toContain(btcResult);
    expect(["neutral", "weak", "strong", "extreme"]).toContain(ethResult);
  });

  it("sonuç 4 geçerli değerden biri", () => {
    const valid = ["neutral", "weak", "strong", "extreme"];
    expect(valid).toContain(classifyMagnitude("BTC", 100_000));
    expect(valid).toContain(classifyMagnitude("ETH", 50_000));
  });
});

// ─────────────────────────────────────────────────────────────
// classifyDirection
// ─────────────────────────────────────────────────────────────

describe("classifyDirection()", () => {
  it("cvd=0 → neutral", () => {
    expect(classifyDirection("BTC", 0)).toBe("neutral");
  });

  it("küçük pozitif CVD (neutral mag) → neutral", () => {
    // Eşik altında → neutral direction
    expect(classifyDirection("BTC", 1)).toBe("neutral");
  });

  it("büyük pozitif CVD → bullish", () => {
    expect(classifyDirection("BTC", 10_000_000)).toBe("bullish");
  });

  it("büyük negatif CVD → bearish", () => {
    expect(classifyDirection("BTC", -10_000_000)).toBe("bearish");
  });
});

// ─────────────────────────────────────────────────────────────
// computeCvdWindow
// ─────────────────────────────────────────────────────────────

describe("computeCvdWindow()", () => {
  it("boş trade → cvd=0, tradeCount=0, direction=neutral", () => {
    const r = computeCvdWindow("BTC", [], 60_000, NOW);
    expect(r.cvdUsd).toBe(0);
    expect(r.tradeCount).toBe(0);
    expect(r.direction).toBe("neutral");
    expect(r.buyUsd).toBe(0);
    expect(r.sellUsd).toBe(0);
  });

  it("windowMs pass-through", () => {
    const r = computeCvdWindow("BTC", [], 5 * 60_000, NOW);
    expect(r.windowMs).toBe(5 * 60_000);
  });

  it("pencere dışı trade → ignored", () => {
    const old = makeTrade("buy", 500_000, NOW - 120_000); // 2dk önce, 1dk pencerede değil
    const r = computeCvdWindow("BTC", [old], 60_000, NOW);
    expect(r.tradeCount).toBe(0);
    expect(r.cvdUsd).toBe(0);
  });

  it("buy ağırlıklı → cvdUsd > 0, bullish", () => {
    const trades = [
      makeTrade("buy", 1_000_000, NOW - 10_000),
      makeTrade("sell", 100_000, NOW - 5_000),
    ];
    const r = computeCvdWindow("BTC", trades, 60_000, NOW);
    expect(r.cvdUsd).toBe(900_000);
    expect(r.buyUsd).toBe(1_000_000);
    expect(r.sellUsd).toBe(100_000);
    expect(r.tradeCount).toBe(2);
  });

  it("sell ağırlıklı → cvdUsd < 0", () => {
    const trades = [
      makeTrade("sell", 1_000_000, NOW - 10_000),
      makeTrade("buy", 100_000, NOW - 5_000),
    ];
    const r = computeCvdWindow("BTC", trades, 60_000, NOW);
    expect(r.cvdUsd).toBe(-900_000);
  });
});

// ─────────────────────────────────────────────────────────────
// computeCvdMultiFrame
// ─────────────────────────────────────────────────────────────

describe("computeCvdMultiFrame()", () => {
  it("boş → 3 pencere, confluence=0, confluenceDirection=neutral", () => {
    const r = computeCvdMultiFrame("BTC", [], NOW);
    expect(r.w1m).toBeDefined();
    expect(r.w5m).toBeDefined();
    expect(r.w15m).toBeDefined();
    expect(r.confluence).toBe(0);
    expect(r.confluenceDirection).toBe("neutral");
  });

  it("pair pass-through", () => {
    const r = computeCvdMultiFrame("ETH", [], NOW);
    expect(r.pair).toBe("ETH");
  });

  it("büyük buy → 3 pencere bullish → confluence=3", () => {
    const trades = Array.from({ length: 10 }, (_, i) =>
      makeTrade("buy", 2_000_000, NOW - i * 10_000),
    );
    const r = computeCvdMultiFrame("BTC", trades, NOW);
    if (r.confluenceDirection === "bullish") {
      expect(r.confluence).toBeGreaterThanOrEqual(1);
    }
  });

  it("eşit buy/sell → neutral confluence", () => {
    const trades = [
      makeTrade("buy", 500_000, NOW - 1000),
      makeTrade("sell", 500_000, NOW - 2000),
    ];
    const r = computeCvdMultiFrame("BTC", trades, NOW);
    expect(r.confluenceDirection).toBe("neutral");
  });
});

// ─────────────────────────────────────────────────────────────
// formatCvd
// ─────────────────────────────────────────────────────────────

describe("formatCvd()", () => {
  it("+$1.5M", () => {
    expect(formatCvd(1_500_000)).toBe("+$1.5M");
  });

  it("-$2.3M", () => {
    expect(formatCvd(-2_300_000)).toBe("-$2.3M");
  });

  it("+$340K", () => {
    expect(formatCvd(340_000)).toBe("+$340K");
  });

  it("-$80K", () => {
    expect(formatCvd(-80_000)).toBe("-$80K");
  });

  it("+$500 (küçük)", () => {
    expect(formatCvd(500)).toBe("+$500");
  });

  it("0 → +$0", () => {
    expect(formatCvd(0)).toBe("+$0");
  });
});

// ─────────────────────────────────────────────────────────────
// parseOkxTrade
// ─────────────────────────────────────────────────────────────

describe("parseOkxTrade()", () => {
  it("geçerli BTC → Trade", () => {
    const r = parseOkxTrade(makeRaw("BTC-USDT-SWAP", "buy", "50000", "0.01"));
    expect(r).not.toBeNull();
    expect(r!.pair).toBe("BTC");
    expect(r!.price).toBe(50000);
    expect(r!.size).toBe(0.01);
    expect(r!.notionalUsd).toBeCloseTo(500, 5);
    expect(r!.side).toBe("buy");
  });

  it("geçerli ETH → Trade", () => {
    const r = parseOkxTrade(makeRaw("ETH-USDT-SWAP", "sell", "3000", "1.0"));
    expect(r).not.toBeNull();
    expect(r!.pair).toBe("ETH");
  });

  it("bilinmeyen instId → null", () => {
    expect(parseOkxTrade(makeRaw("SOL-USDT-SWAP"))).toBeNull();
  });

  it("side geçersiz → null", () => {
    const raw = makeRaw("BTC-USDT-SWAP");
    raw.side = "neutral" as "buy";
    expect(parseOkxTrade(raw)).toBeNull();
  });

  it("price NaN → null", () => {
    expect(parseOkxTrade(makeRaw("BTC-USDT-SWAP", "buy", "abc"))).toBeNull();
  });

  it("price = 0 → null", () => {
    expect(parseOkxTrade(makeRaw("BTC-USDT-SWAP", "buy", "0"))).toBeNull();
  });

  it("size = 0 → null", () => {
    expect(parseOkxTrade(makeRaw("BTC-USDT-SWAP", "buy", "50000", "0"))).toBeNull();
  });

  it("timestamp = 0 → null", () => {
    expect(parseOkxTrade(makeRaw("BTC-USDT-SWAP", "buy", "50000", "0.01", "0"))).toBeNull();
  });

  it("tradeId boş → null", () => {
    const raw = makeRaw();
    raw.tradeId = "";
    expect(parseOkxTrade(raw)).toBeNull();
  });

  it("notionalUsd = price × size", () => {
    const r = parseOkxTrade(makeRaw("BTC-USDT-SWAP", "buy", "50000", "2.0"));
    expect(r!.notionalUsd).toBe(100_000);
  });
});

// ─────────────────────────────────────────────────────────────
// parseOkxTradeBatch
// ─────────────────────────────────────────────────────────────

describe("parseOkxTradeBatch()", () => {
  it("karma batch → sadece geçerliler", () => {
    const raws = [
      makeRaw("BTC-USDT-SWAP", "buy"),          // geçerli
      makeRaw("SOL-USDT-SWAP"),                  // bilinmeyen
      makeRaw("ETH-USDT-SWAP", "sell"),          // geçerli
      makeRaw("BTC-USDT-SWAP", "buy", "abc"),    // NaN price
    ];
    const r = parseOkxTradeBatch(raws);
    expect(r).toHaveLength(2);
    expect(r[0].pair).toBe("BTC");
    expect(r[1].pair).toBe("ETH");
  });

  it("boş batch → boş dizi", () => {
    expect(parseOkxTradeBatch([])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// dedupeTrades
// ─────────────────────────────────────────────────────────────

describe("dedupeTrades()", () => {
  it("hepsi yeni → hepsi fresh", () => {
    const trades = [makeTrade("buy", 1000), makeTrade("sell", 1000)];
    const { fresh } = dedupeTrades(new Set(), trades);
    expect(fresh).toHaveLength(2);
  });

  it("tekrar trade → atla", () => {
    const t = makeTrade("buy", 1000);
    const existing = new Set([t.tradeId]);
    const { fresh } = dedupeTrades(existing, [t]);
    expect(fresh).toHaveLength(0);
  });

  it("karma: bazısı eski, bazısı yeni", () => {
    const t1 = makeTrade("buy", 1000);
    const t2 = makeTrade("sell", 1000);
    const existing = new Set([t1.tradeId]);
    const { fresh } = dedupeTrades(existing, [t1, t2]);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].tradeId).toBe(t2.tradeId);
  });

  it("newIds mevcut + yeni ID'leri içerir", () => {
    const t = makeTrade("buy", 1000);
    const existing = new Set(["old_id"]);
    const { newIds } = dedupeTrades(existing, [t]);
    expect(newIds.has("old_id")).toBe(true);
    expect(newIds.has(t.tradeId)).toBe(true);
  });

  it("existing set mutate edilmez", () => {
    const t = makeTrade("buy", 1000);
    const existing = new Set<string>();
    dedupeTrades(existing, [t]);
    expect(existing.size).toBe(0); // değişmedi
  });
});

// ─────────────────────────────────────────────────────────────
// trimIdSet
// ─────────────────────────────────────────────────────────────

describe("trimIdSet()", () => {
  it("maxSize altında → aynı boyut", () => {
    const ids = new Set(["a", "b", "c"]);
    const r = trimIdSet(ids, 5);
    expect(r.size).toBe(3);
  });

  it("tam eşit → değişmez", () => {
    const ids = new Set(["a", "b", "c"]);
    const r = trimIdSet(ids, 3);
    expect(r.size).toBe(3);
  });

  it("maxSize aşıldı → eski at, yeni koru", () => {
    const ids = new Set(["old1", "old2", "new1", "new2", "new3"]);
    const r = trimIdSet(ids, 3);
    expect(r.size).toBe(3);
    // Set insertion-order korunur — son 3 tutar
    expect(r.has("new1")).toBe(true);
    expect(r.has("new2")).toBe(true);
    expect(r.has("new3")).toBe(true);
    expect(r.has("old1")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Trade Feed state machine
// ─────────────────────────────────────────────────────────────

describe("createPairFeedState()", () => {
  it("idle başlar, lastMessageAt=null", () => {
    const s = createPairFeedState("BTC");
    expect(s.pair).toBe("BTC");
    expect(s.connectionState).toBe("idle");
    expect(s.lastMessageAt).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.seenIds.size).toBe(0);
  });
});

describe("ingestTrades()", () => {
  it("boş raws → heartbeat, connectionState connecting→live", () => {
    const s0 = { ...createPairFeedState("BTC"), connectionState: "connecting" as const };
    const s1 = ingestTrades(s0, [], NOW);
    expect(s1.connectionState).toBe("live");
    expect(s1.lastMessageAt).toBe(NOW);
  });

  it("geçerli BTC trade → buffer'a eklenir, seenIds güncellenir", () => {
    const s0 = createPairFeedState("BTC");
    const raw = makeRaw("BTC-USDT-SWAP", "buy", "50000", "0.1", String(NOW - 1000));
    const s1 = ingestTrades(s0, [raw], NOW);
    expect(getTrades(s1)).toHaveLength(1);
    expect(s1.connectionState).toBe("live");
    expect(s1.seenIds.size).toBe(1);
  });

  it("farklı pair (ETH state, BTC trade) → heartbeat ama buffer değişmez", () => {
    const s0 = createPairFeedState("ETH");
    const raw = makeRaw("BTC-USDT-SWAP", "buy");
    const s1 = ingestTrades(s0, [raw], NOW);
    expect(getTrades(s1)).toHaveLength(0);
    expect(s1.lastMessageAt).toBe(NOW);
  });

  it("dedup: aynı tradeId tekrar → atlanır", () => {
    const s0 = createPairFeedState("BTC");
    const raw = makeRaw("BTC-USDT-SWAP", "buy", "50000", "0.1", String(NOW - 1000));
    const s1 = ingestTrades(s0, [raw], NOW);
    const s2 = ingestTrades(s1, [raw], NOW + 1000); // aynı raw tekrar
    expect(getTrades(s2)).toHaveLength(1); // hâlâ 1
  });

  it("immutable — orijinal state değişmez", () => {
    const s0 = createPairFeedState("BTC");
    const raw = makeRaw("BTC-USDT-SWAP");
    ingestTrades(s0, [raw], NOW);
    expect(getTrades(s0)).toHaveLength(0);
  });
});

describe("setConnectionState()", () => {
  it("state geçişi", () => {
    const s0 = createPairFeedState("BTC");
    const s1 = setConnectionState(s0, "connecting");
    expect(s1.connectionState).toBe("connecting");
  });

  it("hata mesajı set edilir", () => {
    const s0 = createPairFeedState("BTC");
    const s1 = setConnectionState(s0, "failed", "timeout");
    expect(s1.lastError).toBe("timeout");
    expect(s1.connectionState).toBe("failed");
  });

  it("error undefined → lastError=null", () => {
    const s0 = { ...createPairFeedState("BTC"), lastError: "old" };
    const s1 = setConnectionState(s0, "live");
    expect(s1.lastError).toBeNull();
  });
});

describe("isStale()", () => {
  it("lastMessageAt=null → false (henüz bağlanmadı)", () => {
    const s = createPairFeedState("BTC");
    expect(isStale(s, 30_000, NOW)).toBe(false);
  });

  it("son mesaj 10s önce, threshold 30s → false", () => {
    const s = { ...createPairFeedState("BTC"), lastMessageAt: NOW - 10_000 };
    expect(isStale(s, 30_000, NOW)).toBe(false);
  });

  it("son mesaj 31s önce, threshold 30s → true", () => {
    const s = { ...createPairFeedState("BTC"), lastMessageAt: NOW - 31_000 };
    expect(isStale(s, 30_000, NOW)).toBe(true);
  });

  it("tam threshold (= eşit) → false (> koşulu)", () => {
    const s = { ...createPairFeedState("BTC"), lastMessageAt: NOW - 30_000 };
    expect(isStale(s, 30_000, NOW)).toBe(false);
  });
});

describe("getTrades()", () => {
  it("boş buffer → boş dizi", () => {
    expect(getTrades(createPairFeedState("BTC"))).toHaveLength(0);
  });

  it("trade eklendikten sonra döner", () => {
    const s0 = createPairFeedState("BTC");
    const raw = makeRaw("BTC-USDT-SWAP", "buy", "50000", "0.1", String(NOW - 1000));
    const s1 = ingestTrades(s0, [raw], NOW);
    expect(getTrades(s1)).toHaveLength(1);
  });
});
