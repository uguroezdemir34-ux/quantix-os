/**
 * ORDER FLOW — Çekirdek tipler.
 *
 * Trade tick'lerinden başlayıp CVD, VPIN, Delta Divergence'a giden zincirin
 * en alt katmanı.
 *
 * Tasarım kararları:
 *   - Trade.side: "buy" (alıcı agresif) / "sell" (satıcı agresif)
 *     OKX feed'de "taker side" gelir; biz buna güveniriz. Tick rule fallback
 *     ileride lazım olursa eklenir (lib/orderflow/tradeClassifier.ts).
 *   - Trade.priceUsd ve sizeUsd ayrı tutulur → notional hesap kolay.
 *   - Trade.tradeId: borsa-internal ID. Dedup için kullanılır (aynı tick
 *     iki kez gelirse).
 *
 * Pair: BTC, ETH (mevcut sistem). Multi-pair ready — stream'ler paralel.
 */

import type { Pair } from "@/lib/constants/pairs";

/** Bir borsa tick'i (gerçekleşen trade). */
export interface Trade {
  /** Borsa benzersiz ID (dedup için) */
  tradeId: string;
  /** Hangi pair */
  pair: Pair;
  /** Trade'in epoch ms */
  timestamp: number;
  /** Fiyat (USDT cinsinden) */
  price: number;
  /** Hacim (BTC/ETH cinsinden — base asset) */
  size: number;
  /** Notional (USDT — fiyat × hacim) */
  notionalUsd: number;
  /** Taker tarafı: "buy" = alıcı agresif (market buy), "sell" = satıcı agresif */
  side: TradeSide;
}

export type TradeSide = "buy" | "sell";

/**
 * OKX WS trade payload — borsadan gelen ham yapı (subset).
 * Tam dokümantasyon: https://www.okx.com/docs-v5/en/#public-data-websocket-trades-channel
 */
export interface OkxTradeRaw {
  /** ts: epoch ms (string) */
  ts: string;
  /** px: price (string) */
  px: string;
  /** sz: size (string) */
  sz: string;
  /** side: "buy" | "sell" */
  side: TradeSide;
  /** tradeId: unique */
  tradeId: string;
  /** instId: "BTC-USDT-SWAP" gibi */
  instId: string;
}

/**
 * Ring buffer state — son N öğeyi tutan FIFO.
 * Generic değil çünkü Trade'e özel optimizasyonlar var (timestamp sort vs).
 *
 * Eklenen N+1. öğe en eski öğeyi atar. Capacity sabit.
 */
export interface TradeRingBuffer {
  capacity: number;
  /** Eklenen toplam sayı (overflow olsa bile artar) */
  totalAdded: number;
  /** Mevcut items (FIFO sırada — en eski [0], en yeni [length-1]) */
  items: Trade[];
}

/** Ring buffer üzerinde istatistik hesap sonucu. */
export interface FlowStats {
  /** Pencere içindeki trade sayısı */
  count: number;
  /** Buy tarafı toplam notional */
  buyNotionalUsd: number;
  /** Sell tarafı toplam notional */
  sellNotionalUsd: number;
  /** Delta = buy - sell (USD) */
  deltaUsd: number;
  /** İlk trade timestamp */
  firstTs: number | null;
  /** Son trade timestamp */
  lastTs: number | null;
}
