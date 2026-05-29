import { describe, it, expect } from "vitest";
import { InMemoryDedupeStore } from "@/lib/orchestrator/dedupe";

describe("InMemoryDedupeStore", () => {
  it("1. unseen key → isDuplicate false", () => {
    const store = new InMemoryDedupeStore();
    expect(store.isDuplicate("unseen_key", 1_000_000)).toBe(false);
  });

  it("2. record then isDuplicate within 30s → true; after 30001ms → false", () => {
    const store = new InMemoryDedupeStore();
    const t0 = 1_000_000_000;
    store.record("key", t0);

    // Within 30s window
    expect(store.isDuplicate("key", t0 + 1000)).toBe(true);
    expect(store.isDuplicate("key", t0 + 29999)).toBe(true);

    // After 30001ms
    expect(store.isDuplicate("key", t0 + 30001)).toBe(false);
  });

  it("3. clear() resets — record 2 keys, clear(), isDuplicate returns false", () => {
    const store = new InMemoryDedupeStore();
    const t0 = 1_000_000_000;
    store.record("key1", t0);
    store.record("key2", t0);

    store.clear();

    expect(store.isDuplicate("key1", t0 + 1000)).toBe(false);
    expect(store.isDuplicate("key2", t0 + 1000)).toBe(false);
  });

  it("4. GC prunes after 10+ minutes — record at t0, check at t0+11min, size()==0", () => {
    const store = new InMemoryDedupeStore();
    const t0 = 1_000_000_000;
    store.record("key", t0);

    // Check at t0 + 11 minutes (> GC_INTERVAL_MS=10min, > DEDUPE_WINDOW_MS*2=60s)
    const t1 = t0 + 11 * 60 * 1000;
    store.isDuplicate("probe", t1); // triggers GC
    expect(store.size()).toBe(0);
  });
});
