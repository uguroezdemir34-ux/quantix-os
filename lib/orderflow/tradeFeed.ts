/**
 * TRADE FEED — Per-pair state machine.
 *
 * Mimari:
 *   OKX WS → onMessage(raw[]) → parse → dedup → push to ring buffer → emit stats
 *
 * Bu modül saf hesap — WS subscribe LOGİĞİ yok, sadece state transition.
 * WS bağlantısı tradeFeedStore + useTradeFeed hook'unda.
 *
 * State per pair:
 *   - buffer: TradeRingBuffer (son N trade)
 *   - seenIds: Set (dedup için)
 *   - connectionState: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'failed'
 *   - lastMessageAt: ms timestamp (heartbeat için)
 */

import type { Pair } from "@/lib/constants/pairs";
import type { OkxTradeRaw, Trade, TradeRingBuffer } from "./types";
import {
  createRingBuffer,
  pushBatch,
} from "./ringBuffer";
import {
  parseOkxTradeBatch,
  dedupeTrades,
  trimIdSet,
} from "./tradeClassifier";

export type FeedConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "failed";

export interface PairFeedState {
  pair: Pair;
  buffer: TradeRingBuffer;
  /** Görülmüş trade ID'leri (dedup için) */
  seenIds: Set<string>;
  connectionState: FeedConnectionState;
  /** Son mesaj alınma zamanı (heartbeat) */
  lastMessageAt: number | null;
  /** Son hata (varsa) */
  lastError: string | null;
}

/** Per-pair buffer kapasitesi. */
export const DEFAULT_BUFFER_CAPACITY = 1000;

/** Per-pair seenIds max boyut (memory guard). */
export const DEFAULT_SEEN_IDS_MAX = 5000;

/**
 * Pair için boş state oluştur.
 */
export function createPairFeedState(
  pair: Pair,
  capacity: number = DEFAULT_BUFFER_CAPACITY,
): PairFeedState {
  return {
    pair,
    buffer: createRingBuffer(capacity),
    seenIds: new Set(),
    connectionState: "idle",
    lastMessageAt: null,
    lastError: null,
  };
}

/**
 * WS'ten gelen ham trade batch'ini state'e ekle.
 *
 * Adımlar:
 *   1. Raw'ları parse → Trade[]
 *   2. Pair filtresi (sadece bu state'in pair'i)
 *   3. Dedup (seenIds kontrolü)
 *   4. Buffer'a push
 *   5. seenIds güncelle + trim
 *
 * @returns Yeni state (immutable)
 */
export function ingestTrades(
  state: PairFeedState,
  raws: readonly OkxTradeRaw[],
  now: number = Date.now(),
): PairFeedState {
  // 1. Parse
  const allParsed = parseOkxTradeBatch(raws);

  // 2. Pair filter
  const parsed = allParsed.filter((t) => t.pair === state.pair);
  if (parsed.length === 0) {
    // Hiçbir mesaj bu pair için değil ama yine de live'a geç + heartbeat güncelle
    return {
      ...state,
      connectionState: state.connectionState === "connecting" ? "live" : state.connectionState,
      lastMessageAt: now,
    };
  }

  // 3. Dedup
  const { fresh, newIds } = dedupeTrades(state.seenIds, parsed);

  // 4. Buffer push
  const newBuffer = pushBatch(state.buffer, fresh);

  // 5. seenIds trim
  const trimmedIds = trimIdSet(newIds, DEFAULT_SEEN_IDS_MAX);

  return {
    pair: state.pair,
    buffer: newBuffer,
    seenIds: trimmedIds,
    connectionState: "live",
    lastMessageAt: now,
    lastError: null,
  };
}

/**
 * Connection state geçişi.
 */
export function setConnectionState(
  state: PairFeedState,
  next: FeedConnectionState,
  error?: string,
): PairFeedState {
  return {
    ...state,
    connectionState: next,
    lastError: error ?? null,
  };
}

/**
 * Heartbeat kontrolü — son mesaj çok eskiyse stale.
 *
 * @param state Pair state
 * @param staleThresholdMs ms (default 30 saniye)
 * @param now Şimdi
 * @returns true ise stale (mesaj akmıyor)
 */
export function isStale(
  state: PairFeedState,
  staleThresholdMs: number = 30_000,
  now: number = Date.now(),
): boolean {
  if (state.lastMessageAt === null) return false; // henüz hiç mesaj gelmemiş
  return now - state.lastMessageAt > staleThresholdMs;
}

/**
 * Sadece okuma — Trade[] döner (UI/store için)
 */
export function getTrades(state: PairFeedState): readonly Trade[] {
  return state.buffer.items;
}
