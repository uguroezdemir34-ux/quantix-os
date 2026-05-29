/**
 * DEDUPE STORE — In-memory idempotency.
 *
 * Aynı sinyal (pair + direction) 30 saniye içinde 2 kez tetiklenmesin.
 * Botların hızlı poll'lerinde de UI'nin double-click'inde de korur.
 *
 * Module-level singleton — process boyunca yaşar (Next.js dev'de hot-reload'da resetlenir).
 */

import type { DedupeStore } from "./types";

/** 30 saniyelik bucket window */
const DEDUPE_WINDOW_MS = 30000;

/** Eski kayıtlar ne sıklıkla temizlensin (10 dk) */
const GC_INTERVAL_MS = 10 * 60 * 1000;

export class InMemoryDedupeStore implements DedupeStore {
  private records: Map<string, number> = new Map();
  private lastGc = 0;

  isDuplicate(key: string, now: number = Date.now()): boolean {
    this.maybeGc(now);
    const recordedAt = this.records.get(key);
    if (recordedAt === undefined) return false;
    return now - recordedAt < DEDUPE_WINDOW_MS;
  }

  record(key: string, now: number = Date.now()): void {
    this.maybeGc(now);
    this.records.set(key, now);
  }

  clear(): void {
    this.records.clear();
    this.lastGc = 0;
  }

  /** Görünmez yan-etki: eski kayıtları sil */
  private maybeGc(now: number): void {
    if (now - this.lastGc < GC_INTERVAL_MS) return;
    this.lastGc = now;
    for (const [key, ts] of this.records.entries()) {
      if (now - ts > DEDUPE_WINDOW_MS * 2) {
        this.records.delete(key);
      }
    }
  }

  /** Test için — kayıtlı entry sayısı */
  size(): number {
    return this.records.size;
  }
}

/** Module-level singleton (production) */
let globalStore: InMemoryDedupeStore | null = null;

export function getGlobalDedupeStore(): InMemoryDedupeStore {
  if (!globalStore) {
    globalStore = new InMemoryDedupeStore();
  }
  return globalStore;
}

/** Test için — singleton'ı sıfırla */
export function _resetGlobalDedupeStoreForTesting(): void {
  globalStore = null;
}
