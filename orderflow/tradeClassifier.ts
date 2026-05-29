/**
 * TRADE CLASSIFIER — OKX raw payload → bizim Trade tipi.
 *
 * Bu katman:
 *   1. instId'den pair tespit eder (BTC-USDT-SWAP → "BTC")
 *   2. String numerikleri parse eder, NaN guard
 *   3. notionalUsd hesaplar (price × size)
 *   4. side'ı bizim tipimize map eder
 *   5. Bilinmeyen instrument'leri reject eder (BTC/ETH only)
 *
 * Tick rule (zaten OKX side veriyor ama gelecekte exchange'ler eklenirse):
 *   Geleneksel finansta side belirsizse:
 *     - price > previous mid → buy initiated
 *     - price < previous mid → sell initiated
 *   OKX bunu doğrudan veriyor; lazım olursa ileride eklenir.
 */

import type { OkxTradeRaw, Trade, TradeSide } from "./types";
import type { Pair } from "@/lib/constants/pairs";

/**
 * Instrument ID → Pair mapping.
 * Şu an sadece BTC ve ETH perpetual swap'ları destekliyoruz.
 */
const INST_ID_TO_PAIR: Record<string, Pair> = {
  "BTC-USDT-SWAP": "BTC",
  "ETH-USDT-SWAP": "ETH",
};

/**
 * Desteklenen instrument'lerin listesi (WS subscribe için).
 */
export const SUPPORTED_INST_IDS: readonly string[] =
  Object.keys(INST_ID_TO_PAIR);

/**
 * OKX trade payload'ını Trade tipine dönüştür.
 *
 * @returns Trade veya null (parse fail / desteklenmeyen instrument)
 */
export function parseOkxTrade(raw: OkxTradeRaw): Trade | null {
  // Pair tanı
  const pair = INST_ID_TO_PAIR[raw.instId];
  if (!pair) return null;

  // Side validation
  if (raw.side !== "buy" && raw.side !== "sell") return null;
  const side: TradeSide = raw.side;

  // Numeric parse
  const timestamp = parseInt(raw.ts, 10);
  const price = parseFloat(raw.px);
  const size = parseFloat(raw.sz);

  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(size) || size <= 0) return null;
  if (!raw.tradeId) return null;

  return {
    tradeId: raw.tradeId,
    pair,
    timestamp,
    price,
    size,
    notionalUsd: price * size,
    side,
  };
}

/**
 * Bir batch raw trade parse et — invalid olanları filtrele.
 */
export function parseOkxTradeBatch(raws: readonly OkxTradeRaw[]): Trade[] {
  const out: Trade[] = [];
  for (const raw of raws) {
    const t = parseOkxTrade(raw);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Trade dedup — aynı tradeId tekrar geldiyse atla.
 * WS reconnect sonrası bazen aynı tick iki kez gelir.
 *
 * @param existingIds Set of trade IDs already seen
 * @param trades New trades to filter
 * @returns Sadece yeni olan trade'ler + güncellenmiş ID set'i
 */
export function dedupeTrades(
  existingIds: ReadonlySet<string>,
  trades: readonly Trade[],
): { fresh: Trade[]; newIds: Set<string> } {
  const fresh: Trade[] = [];
  const newIds = new Set(existingIds);
  for (const t of trades) {
    if (!newIds.has(t.tradeId)) {
      newIds.add(t.tradeId);
      fresh.push(t);
    }
  }
  return { fresh, newIds };
}

/**
 * ID set'ini trim et — sınırsız büyümesin.
 * Trade ID'ler sayısal artıyor (OKX); en eski K tanesini at.
 *
 * @param ids Mevcut set
 * @param maxSize Max boyut
 * @returns Trim edilmiş set
 */
export function trimIdSet(
  ids: ReadonlySet<string>,
  maxSize: number,
): Set<string> {
  if (ids.size <= maxSize) return new Set(ids);
  // Set insertion-order korur; en eski entries iterator başında
  const trimmed = new Set<string>();
  const all = Array.from(ids);
  const start = all.length - maxSize;
  for (let i = start; i < all.length; i++) {
    trimmed.add(all[i]);
  }
  return trimmed;
}
