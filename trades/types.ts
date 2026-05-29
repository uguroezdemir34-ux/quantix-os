/**
 * TRADE SNAPSHOT — Post-trade intelligence için zenginleştirilmiş trade kaydı.
 *
 * DisciplineLog'tan farklı:
 *   - Bir trade için 1 kayıt (DisciplineLog'da open + close ayrı event'ler)
 *   - Entry context dahil (skor + sebep + macro snapshot)
 *   - Lifecycle açık: pending → open → closed
 *   - Forward test / real ayrımı
 *
 * Bu, gelecekte AI destekli analiz için ham veridir
 * ("hangi macro durumda BTC LONG kazandı?" vb.).
 */

import type { Pair } from "@/lib/constants/pairs";

export type TradeStatus = "pending" | "open" | "closed";

export type ExitReason = "tp1" | "tp2" | "sl" | "manual" | "trail";

// ═══════════════ ENTRY CONTEXT ═══════════════

/**
 * Trade açılırken yakalanan piyasa durumu — analiz için referans.
 */
export interface EntryContext {
  /** Score Engine verdict'i */
  score: number;
  /** Verdict kararı (genelde "go") */
  verdict: "go" | "wait" | "no";
  /** Confidence (0-1) */
  confidence?: number;
  /** Counter-trend mi (alt timeframe'in üst trend'e karşı) */
  counterTrend?: boolean;
  /** İnsanca okunabilir ana sebep */
  reasonText?: string;
  /** Macro snapshot: F&G değeri (entry anında) */
  fgValue?: number;
  /** Macro snapshot: BTC dominansı */
  btcDominance?: number;
  /** Macro snapshot: funding rate */
  fundingRate?: number;
  /** Drawdown tier (entry anında) */
  drawdownTier?: "normal" | "caution" | "restricted" | "locked";
}

// ═══════════════ EXIT INFO ═══════════════

export interface ExitInfo {
  /** Kapanış zamanı */
  closedAt: number;
  /** Kapanış fiyatı */
  exitPrice: number;
  /** Kapanış sebebi */
  reason: ExitReason;
  /** Realized P&L (USDT, signed) */
  pnlUsd: number;
  /** Realized P&L yüzdesi (entry'e göre, signed) */
  pnlPct: number;
  /** Holding süresi (saniye) */
  holdingSec: number;
  /** R multiple — (pnl / risk_amount) */
  rMultiple?: number;
}

// ═══════════════ TRADE SNAPSHOT ═══════════════

/**
 * Tek trade'in tam görüntüsü.
 *
 * - status: 'pending' iken adapter henüz onaylamamış (race window)
 * - status: 'open' iken pozisyon canlı, exit yok
 * - status: 'closed' iken exit dolu
 */
export interface TradeSnapshot {
  /** Benzersiz kimlik (uuid veya entry-timestamp+pair+direction hash) */
  id: string;
  /** Borsa order ID (varsa) */
  orderId?: string;

  // Temel veriler
  pair: Pair;
  direction: "LONG" | "SHORT";
  status: TradeStatus;

  // Entry
  openedAt: number;
  entryPrice: number;
  qty: number;
  leverage: number;
  /** SL fiyatı (entry anında belirlenen) */
  stopPrice: number;
  /** TP1 fiyatı (varsa) */
  takeProfit1?: number;
  /** TP2 fiyatı (varsa) */
  takeProfit2?: number;

  // Risk
  /** Risk amount USDT (SL'e kadar olası kayıp) — R-multiple için */
  riskAmountUsd: number;

  // Forward test mi gerçek mi
  isPaper: boolean;

  // Context (entry anında yakalandı)
  entryContext: EntryContext;

  // Exit (status='closed' iken dolu)
  exit?: ExitInfo;
}

// ═══════════════ INPUT TYPES ═══════════════

/**
 * Yeni trade açmak için input — id otomatik üretilir.
 */
export interface OpenTradeInput {
  pair: Pair;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  qty: number;
  leverage: number;
  stopPrice: number;
  takeProfit1?: number;
  takeProfit2?: number;
  riskAmountUsd: number;
  isPaper: boolean;
  entryContext: EntryContext;
  /** Borsa order ID (adapter'dan dönmüşse) */
  orderId?: string;
  /** Şimdi (test injection için) */
  now?: number;
}

/**
 * Trade kapatmak için input.
 */
export interface CloseTradeInput {
  id: string;
  exitPrice: number;
  reason: ExitReason;
  now?: number;
}

// ═══════════════ HELPER ═══════════════

/**
 * Trade ID üret — pair + direction + entry timestamp.
 * Aynı sn aynı pair + direction'da iki trade açılmaz (dedup paket #8.5'te).
 */
export function buildTradeId(
  pair: Pair,
  direction: "LONG" | "SHORT",
  openedAt: number,
): string {
  return `${pair}_${direction}_${openedAt}`;
}
