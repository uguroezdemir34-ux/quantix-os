/**
 * RING BUFFER — Sabit boyut FIFO.
 *
 * Trade tick'leri sonsuz akıyor. Hepsini tutamayız (bellek + render maliyeti).
 * Son N tane'yi tutarız; N+1. eklenince en eski atılır.
 *
 * Saf hesap modülü — tüm fonksiyonlar input → yeni output (immutable).
 * Mutasyon yapmıyoruz; her ekleme yeni TradeRingBuffer döner. Bu, Zustand
 * ile mükemmel uyumlu (referans değişimi → re-render tetiklenir).
 *
 * Performans notu:
 *   - push() O(1) amortize (slice maliyeti küçük N için ihmal edilebilir)
 *   - statistics() O(n) — pencere üzerinde tek pass
 *   - Tipik N: 1000 (BTC için ~30dk), 500 (ETH için)
 */

import type { Trade, TradeRingBuffer, FlowStats } from "./types";

/**
 * Boş ring buffer oluştur.
 *
 * @throws Error eğer capacity ≤ 0
 */
export function createRingBuffer(capacity: number): TradeRingBuffer {
  if (capacity <= 0) {
    throw new Error(`Ring buffer capacity must be > 0, got ${capacity}`);
  }
  return {
    capacity,
    totalAdded: 0,
    items: [],
  };
}

/**
 * Bir trade ekle. Capacity aşılırsa en eski atılır.
 *
 * @returns Yeni buffer (immutable — orijinal değişmez)
 */
export function push(buf: TradeRingBuffer, trade: Trade): TradeRingBuffer {
  const newItems = [...buf.items, trade];
  // Capacity aşıldıysa en eskilerini at
  if (newItems.length > buf.capacity) {
    newItems.splice(0, newItems.length - buf.capacity);
  }
  return {
    capacity: buf.capacity,
    totalAdded: buf.totalAdded + 1,
    items: newItems,
  };
}

/**
 * Birden fazla trade ekle (batch — feed reconnect sonrası).
 */
export function pushBatch(
  buf: TradeRingBuffer,
  trades: readonly Trade[],
): TradeRingBuffer {
  if (trades.length === 0) return buf;
  const newItems = [...buf.items, ...trades];
  if (newItems.length > buf.capacity) {
    newItems.splice(0, newItems.length - buf.capacity);
  }
  return {
    capacity: buf.capacity,
    totalAdded: buf.totalAdded + trades.length,
    items: newItems,
  };
}

/**
 * Buffer'ı temizle ama capacity korunur.
 */
export function clear(buf: TradeRingBuffer): TradeRingBuffer {
  return {
    capacity: buf.capacity,
    totalAdded: 0,
    items: [],
  };
}

/**
 * Belirli timestamp eşiği sonrası gelen trade'leri filtrele.
 * Örnek: son 5dk → afterTs = now - 5*60_000
 *
 * Items zaten timestamp ascending — binary search yapabiliriz ama
 * tipik N=1000 için linear scan yeterli (< 1ms).
 */
export function filterAfter(
  buf: TradeRingBuffer,
  afterTs: number,
): Trade[] {
  return buf.items.filter((t) => t.timestamp >= afterTs);
}

/**
 * Buffer'daki trade'lerin istatistiklerini hesapla.
 * Boş buffer → sıfırlar.
 */
export function statistics(trades: readonly Trade[]): FlowStats {
  if (trades.length === 0) {
    return {
      count: 0,
      buyNotionalUsd: 0,
      sellNotionalUsd: 0,
      deltaUsd: 0,
      firstTs: null,
      lastTs: null,
    };
  }

  let buyNotionalUsd = 0;
  let sellNotionalUsd = 0;
  for (const t of trades) {
    if (t.side === "buy") {
      buyNotionalUsd += t.notionalUsd;
    } else {
      sellNotionalUsd += t.notionalUsd;
    }
  }

  return {
    count: trades.length,
    buyNotionalUsd,
    sellNotionalUsd,
    deltaUsd: buyNotionalUsd - sellNotionalUsd,
    firstTs: trades[0].timestamp,
    lastTs: trades[trades.length - 1].timestamp,
  };
}

/**
 * Buffer'daki en yeni trade.
 */
export function lastTrade(buf: TradeRingBuffer): Trade | null {
  return buf.items.length > 0 ? buf.items[buf.items.length - 1] : null;
}

/**
 * Buffer doluluk oranı (0-1).
 */
export function fillRatio(buf: TradeRingBuffer): number {
  return buf.items.length / buf.capacity;
}
