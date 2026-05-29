/**
 * ORDER FLOW — Ring Buffer + Trade Feed Tests
 *
 * Ring buffer: capacity, push, overflow, statistics.
 * Trade classifier: OKX raw parse, pair extraction, dedup.
 */

import { describe, it, expect } from "vitest";
import {
  createRingBuffer,
  push,
  pushBatch,
  clear,
  filterAfter,
  statistics,
  lastTrade,
  fillRatio,
} from "@/lib/orderflow/ringBuffer";
import {
  parseOkxTradeBatch,
  dedupeTrades,
  trimIdSet,
} from "@/lib/orderflow/tradeClassifier";
import type { Trade } from "@/lib/orderflow/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeTrade(id: string, side: "buy" | "sell" = "buy", price = 50000): Trade {
  return {
    tradeId: id,
    pair: "BTC",
    timestamp: Date.now(),
    price,
    size: 0.1,
    notionalUsd: price * 0.1,
    side,
  };
}

// ─────────────────────────────────────────────────────────────
// Ring Buffer
// ─────────────────────────────────────────────────────────────

describe("createRingBuffer()", () => {
  it("starts empty", () => {
    const buf = createRingBuffer(100);
    expect(buf.items).toHaveLength(0);
    expect(buf.totalAdded).toBe(0);
    expect(buf.capacity).toBe(100);
  });

  it("throws for capacity <= 0", () => {
    expect(() => createRingBuffer(0)).toThrow();
    expect(() => createRingBuffer(-1)).toThrow();
  });
});

describe("push()", () => {
  it("adds trade", () => {
    const buf = push(createRingBuffer(10), makeTrade("t1"));
    expect(buf.items).toHaveLength(1);
    expect(buf.totalAdded).toBe(1);
  });

  it("immutable — original unchanged", () => {
    const original = createRingBuffer(10);
    push(original, makeTrade("t1"));
    expect(original.items).toHaveLength(0);
  });

  it("overflow: oldest item dropped when at capacity", () => {
    let buf = createRingBuffer(3);
    buf = push(buf, makeTrade("t1"));
    buf = push(buf, makeTrade("t2"));
    buf = push(buf, makeTrade("t3"));
    buf = push(buf, makeTrade("t4")); // t1 should be dropped
    expect(buf.items).toHaveLength(3);
    expect(buf.items[0].tradeId).toBe("t2");
    expect(buf.items[2].tradeId).toBe("t4");
    expect(buf.totalAdded).toBe(4);
  });
});

describe("pushBatch()", () => {
  it("adds multiple trades", () => {
    const trades = [makeTrade("t1"), makeTrade("t2"), makeTrade("t3")];
    const buf = pushBatch(createRingBuffer(100), trades);
    expect(buf.items).toHaveLength(3);
  });

  it("empty batch → buffer unchanged", () => {
    const original = createRingBuffer(10);
    const result = pushBatch(original, []);
    expect(result.items).toHaveLength(0);
  });

  it("overflow in batch handled correctly", () => {
    let buf = createRingBuffer(3);
    const trades = [makeTrade("t1"), makeTrade("t2"), makeTrade("t3"), makeTrade("t4"), makeTrade("t5")];
    buf = pushBatch(buf, trades);
    expect(buf.items).toHaveLength(3);
    expect(buf.items[0].tradeId).toBe("t3");
    expect(buf.items[2].tradeId).toBe("t5");
  });
});

describe("clear()", () => {
  it("empties items but preserves capacity and totalAdded", () => {
    let buf = createRingBuffer(10);
    buf = push(buf, makeTrade("t1"));
    buf = push(buf, makeTrade("t2"));
    const cleared = clear(buf);
    expect(cleared.items).toHaveLength(0);
    expect(cleared.capacity).toBe(10);
    expect(cleared.totalAdded).toBe(2); // totalAdded preserved
  });
});

describe("filterAfter()", () => {
  it("returns only trades after timestamp", () => {
    const now = Date.now();
    let buf = createRingBuffer(100);
    buf = push(buf, { ...makeTrade("old"), timestamp: now - 10_000 });
    buf = push(buf, { ...makeTrade("recent"), timestamp: now - 1_000 });
    const result = filterAfter(buf, now - 5_000);
    expect(result).toHaveLength(1);
    expect(result[0].tradeId).toBe("recent");
  });
});

describe("statistics()", () => {
  it("empty → all zeros", () => {
    const stats = statistics([]);
    expect(stats.count).toBe(0);
    expect(stats.deltaUsd).toBe(0);
    expect(stats.buyNotionalUsd).toBe(0);
    expect(stats.sellNotionalUsd).toBe(0);
  });

  it("all buys → delta positive", () => {
    const trades = [makeTrade("t1", "buy"), makeTrade("t2", "buy")];
    const stats = statistics(trades);
    expect(stats.deltaUsd).toBeGreaterThan(0);
    expect(stats.sellNotionalUsd).toBe(0);
  });

  it("buy == sell → delta near 0", () => {
    const trades = [makeTrade("t1", "buy"), makeTrade("t2", "sell")];
    const stats = statistics(trades);
    expect(stats.deltaUsd).toBeCloseTo(0);
  });
});

describe("lastTrade()", () => {
  it("null for empty buffer", () => {
    expect(lastTrade(createRingBuffer(10))).toBeNull();
  });

  it("returns most recently added trade", () => {
    let buf = createRingBuffer(10);
    buf = push(buf, makeTrade("t1"));
    buf = push(buf, makeTrade("t2"));
    expect(lastTrade(buf)!.tradeId).toBe("t2");
  });
});

describe("fillRatio()", () => {
  it("empty → 0", () => {
    expect(fillRatio(createRingBuffer(100))).toBe(0);
  });

  it("full → 1", () => {
    let buf = createRingBuffer(3);
    buf = push(buf, makeTrade("t1"));
    buf = push(buf, makeTrade("t2"));
    buf = push(buf, makeTrade("t3"));
    expect(fillRatio(buf)).toBe(1);
  });

  it("half full → 0.5", () => {
    let buf = createRingBuffer(4);
    buf = push(buf, makeTrade("t1"));
    buf = push(buf, makeTrade("t2"));
    expect(fillRatio(buf)).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────
// Trade Classifier (OKX raw parse)
// ─────────────────────────────────────────────────────────────

describe("parseOkxTradeBatch()", () => {
  const validRaw = {
    instId: "BTC-USDT-SWAP",
    px: "50000",
    sz: "0.1",
    side: "buy" as const,
    tradeId: "abc123",
    ts: "1700000000000",
  };

  it("parses valid BTC trade", () => {
    const result = parseOkxTradeBatch([validRaw]);
    expect(result).toHaveLength(1);
    expect(result[0].pair).toBe("BTC");
    expect(result[0].price).toBe(50000);
    expect(result[0].size).toBe(0.1);
    expect(result[0].side).toBe("buy");
    expect(result[0].notionalUsd).toBeCloseTo(5000);
  });

  it("parses ETH-USDT-SWAP → pair ETH", () => {
    const ethRaw = { ...validRaw, instId: "ETH-USDT-SWAP", px: "2000" };
    const result = parseOkxTradeBatch([ethRaw]);
    expect(result[0].pair).toBe("ETH");
  });

  it("skips unknown instrument", () => {
    const unknownRaw = { ...validRaw, instId: "SOL-USDT-SWAP" };
    const result = parseOkxTradeBatch([unknownRaw]);
    expect(result).toHaveLength(0);
  });

  it("skips invalid price", () => {
    const badPrice = { ...validRaw, px: "NaN" };
    const result = parseOkxTradeBatch([badPrice]);
    expect(result).toHaveLength(0);
  });

  it("batch: multiple trades parsed", () => {
    const raw2 = { ...validRaw, tradeId: "xyz456", side: "sell" as const };
    const result = parseOkxTradeBatch([validRaw, raw2]);
    expect(result).toHaveLength(2);
    expect(result[0].side).toBe("buy");
    expect(result[1].side).toBe("sell");
  });
});

describe("dedupeTrades()", () => {
  it("fresh trade passes through", () => {
    const seenIds = new Set<string>();
    const trade = makeTrade("t1");
    const { fresh, newIds } = dedupeTrades(seenIds, [trade]);
    expect(fresh).toHaveLength(1);
    expect(newIds.has("t1")).toBe(true);
  });

  it("duplicate trade is filtered out", () => {
    const seenIds = new Set(["t1"]);
    const trade = makeTrade("t1");
    const { fresh } = dedupeTrades(seenIds, [trade]);
    expect(fresh).toHaveLength(0);
  });

  it("mixed fresh + duplicate", () => {
    const seenIds = new Set(["t1"]);
    const { fresh } = dedupeTrades(seenIds, [makeTrade("t1"), makeTrade("t2")]);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].tradeId).toBe("t2");
  });
});

describe("trimIdSet()", () => {
  it("unchanged when under max", () => {
    const ids = new Set(["a", "b", "c"]);
    const result = trimIdSet(ids, 10);
    expect(result.size).toBe(3);
  });

  it("trims to max when exceeded", () => {
    const ids = new Set(Array.from({ length: 100 }, (_, i) => `t${i}`));
    const result = trimIdSet(ids, 50);
    expect(result.size).toBeLessThanOrEqual(50);
  });
});
