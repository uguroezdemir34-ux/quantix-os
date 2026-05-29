/**
 * ORDER BOOK DEPTH — Emir defteri derinlik analizi.
 *
 * Sorumluluklar:
 *   1. OKX ham emir defteri payload'ını tip-güvenli OrderBookSnapshot'a parse et.
 *   2. Üst N seviyedeki bid/ask notional dengesizliğini hesapla.
 *   3. Score engine'e doğrudan beslenebilecek imbalanceRatio üret.
 *
 * Tüm fonksiyonlar saf (pure) — I/O yok.
 *
 * OKX WS order book kanalı: "books5" (ilk 5 seviye, 100ms güncelleme)
 * veya "books" (400 seviye, diff).
 * Referans: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-order-book
 */

import type { Pair } from "@/lib/constants/pairs";

// ─── Tipler ──────────────────────────────────────────────────

/** Tek bir fiyat seviyesi (bid veya ask). */
export interface OrderBookLevel {
  /** Fiyat (USDT) */
  price: number;
  /** Miktar (base asset — BTC/ETH) */
  qty: number;
  /** Notional değer (USDT — fiyat × miktar) */
  notionalUsd: number;
}

/**
 * Normalize edilmiş order book snapshot.
 * bids: fiyata göre azalan sıra (en iyi bid [0]).
 * asks: fiyata göre artan sıra (en iyi ask [0]).
 */
export interface OrderBookSnapshot {
  pair: Pair;
  /** Epoch ms (OKX ts alanından) */
  timestamp: number;
  /** Alıcı emirleri — desc fiyat sıralı */
  bids: OrderBookLevel[];
  /** Satıcı emirleri — asc fiyat sıralı */
  asks: OrderBookLevel[];
}

/**
 * OKX ham order book payload (books5 veya books kanalı).
 * Her level: [price_str, qty_str, deprecated_str, order_count_str]
 */
export interface OkxOrderBookRaw {
  /** Epoch ms string */
  ts: string;
  /** Bid seviyeleri: [price, qty, deprecated, orders] */
  bids: Array<[string, string, string?, string?]>;
  /** Ask seviyeleri: [price, qty, deprecated, orders] */
  asks: Array<[string, string, string?, string?]>;
  /** "BTC-USDT-SWAP" gibi */
  instId: string;
}

/**
 * Bid/Ask dengesizlik analizi sonucu.
 *
 * imbalanceRatio ∈ [-1, +1]:
 *   +1 → tamamen bid tarafı (güçlü alım baskısı)
 *   -1 → tamamen ask tarafı (güçlü satım baskısı)
 *    0 → dengeli
 */
export interface OrderBookImbalance {
  /** Analiz edilen üst N seviyedeki toplam bid notional (USDT) */
  bidNotionalUsd: number;
  /** Analiz edilen üst N seviyedeki toplam ask notional (USDT) */
  askNotionalUsd: number;
  /**
   * Dengesizlik oranı: (bid - ask) / (bid + ask)
   * bid+ask=0 ise 0 döner (güvenli).
   */
  imbalanceRatio: number;
  /** Yön yorumu */
  direction: "bid_dominated" | "ask_dominated" | "balanced";
  /** Analiz edilen seviye sayısı (min(topN, mevcut seviye)) */
  depthLevels: number;
}

/**
 * Eşik: bid_dominated / ask_dominated karar sınırı.
 * |ratio| > 0.2 → yönlü sinyal; altı → balanced.
 */
export const IMBALANCE_DIRECTION_THRESHOLD = 0.2;

// ─── Parser ──────────────────────────────────────────────────

/**
 * OKX ham order book payload → OrderBookSnapshot.
 *
 * Geçersiz (NaN) fiyat veya miktar olan seviyeler sessizce atlanır.
 * Sıralama garantisi: bids desc, asks asc (OKX genellikle sıralı gönderir,
 * ama normalize etmek güvenli).
 */
export function parseOkxOrderBook(
  raw: OkxOrderBookRaw,
  pair: Pair,
): OrderBookSnapshot {
  const timestamp = parseInt(raw.ts, 10) || 0;

  const parseLevels = (
    raw: Array<[string, string, string?, string?]>,
  ): OrderBookLevel[] => {
    const out: OrderBookLevel[] = [];
    for (const level of raw) {
      const price = parseFloat(level[0]);
      const qty = parseFloat(level[1]);
      if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty < 0) continue;
      out.push({ price, qty, notionalUsd: price * qty });
    }
    return out;
  };

  const bids = parseLevels(raw.bids).sort((a, b) => b.price - a.price);
  const asks = parseLevels(raw.asks).sort((a, b) => a.price - b.price);

  return { pair, timestamp, bids, asks };
}

// ─── Dengesizlik Hesabı ───────────────────────────────────────

/**
 * Üst `topN` seviyedeki bid/ask notional dengesizliği.
 *
 * topN varsayılan 5 (books5 kanalıyla uyumlu).
 * Her iki tarafta da hiç seviye yoksa null döner.
 */
export function computeOrderBookImbalance(
  snapshot: OrderBookSnapshot,
  topN = 5,
): OrderBookImbalance | null {
  const bids = snapshot.bids.slice(0, topN);
  const asks = snapshot.asks.slice(0, topN);

  if (bids.length === 0 && asks.length === 0) return null;

  let bidNotionalUsd = 0;
  for (const b of bids) bidNotionalUsd += b.notionalUsd;

  let askNotionalUsd = 0;
  for (const a of asks) askNotionalUsd += a.notionalUsd;

  const total = bidNotionalUsd + askNotionalUsd;
  const imbalanceRatio = total === 0 ? 0 : (bidNotionalUsd - askNotionalUsd) / total;

  let direction: OrderBookImbalance["direction"];
  if (imbalanceRatio > IMBALANCE_DIRECTION_THRESHOLD) {
    direction = "bid_dominated";
  } else if (imbalanceRatio < -IMBALANCE_DIRECTION_THRESHOLD) {
    direction = "ask_dominated";
  } else {
    direction = "balanced";
  }

  return {
    bidNotionalUsd,
    askNotionalUsd,
    imbalanceRatio,
    direction,
    depthLevels: Math.max(bids.length, asks.length),
  };
}

// ─── Score Engine Feed Helper ─────────────────────────────────

/**
 * Order book imbalance → [-1, +1] skaler sinyal.
 * Score engine'e doğrudan beslenebilir (skalerleri normalize eder).
 *
 * null snapshot → 0 (tarafsız).
 */
export function orderBookSignal(
  snapshot: OrderBookSnapshot | null,
  topN = 5,
): number {
  if (!snapshot) return 0;
  const imbalance = computeOrderBookImbalance(snapshot, topN);
  return imbalance ? imbalance.imbalanceRatio : 0;
}
