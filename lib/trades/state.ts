/**
 * TRADE STATE MACHINE — Saf transition fonksiyonları.
 *
 * Geçerli geçişler:
 *   pending → open    (adapter confirm)
 *   pending → closed  (adapter reject, rare — error state)
 *   open    → closed  (TP/SL hit veya manual)
 *
 * Yasak geçişler:
 *   closed → herhangi bir şey (immutable)
 *   open → pending (geri dönüş yok)
 */

import type {
  TradeSnapshot,
  ExitInfo,
  CloseTradeInput,
  OpenTradeInput,
  EquityHaltState,
  EquityHaltReason,
} from "./types";
import { buildTradeId } from "./types";
import {
  computeEquityCurveDecision,
  type EquityCurveInput,
} from "@/lib/risk/equity-curve";

// ═══════════════ TRANSITIONS ═══════════════

/**
 * Yeni trade snapshot oluştur (pending durumda).
 */
export function createPendingTrade(input: OpenTradeInput): TradeSnapshot {
  const now = input.now ?? Date.now();
  return {
    id: buildTradeId(input.pair, input.direction, now),
    orderId: input.orderId,
    pair: input.pair,
    direction: input.direction,
    status: "pending",
    openedAt: now,
    entryPrice: input.entryPrice,
    qty: input.qty,
    leverage: input.leverage,
    stopPrice: input.stopPrice,
    takeProfit1: input.takeProfit1,
    takeProfit2: input.takeProfit2,
    riskAmountUsd: input.riskAmountUsd,
    isPaper: input.isPaper,
    entryContext: { ...input.entryContext },
  };
}

/**
 * Pending → open (adapter onayladı).
 *
 * @throws Error eğer status pending değilse
 */
export function confirmOpen(
  trade: TradeSnapshot,
  orderId?: string,
): TradeSnapshot {
  if (trade.status !== "pending") {
    throw new Error(
      `confirmOpen: trade ${trade.id} is ${trade.status}, expected pending`,
    );
  }
  return {
    ...trade,
    status: "open",
    orderId: orderId ?? trade.orderId,
  };
}

/**
 * Pending/open → closed (TP/SL hit veya manual).
 *
 * @throws Error eğer status closed ise (immutable)
 */
export function closeTrade(
  trade: TradeSnapshot,
  input: CloseTradeInput,
): TradeSnapshot {
  if (trade.status === "closed") {
    throw new Error(`closeTrade: trade ${trade.id} already closed`);
  }
  const now = input.now ?? Date.now();
  const exit = computeExit(trade, input.exitPrice, input.reason, now);
  return {
    ...trade,
    status: "closed",
    exit,
  };
}

// ═══════════════ EXIT COMPUTATION ═══════════════

/**
 * Exit info hesabı — P&L, holding süresi, R multiple.
 *
 * LONG: pnl = (exit - entry) * qty
 * SHORT: pnl = (entry - exit) * qty
 *
 * R multiple: realized PnL / risk amount (SL'e kadar olası kayıp).
 *   Win 2R = "2 kez riske attığım kadar kazandım"
 *   Loss -1R = "tam stop aldım"
 */
export function computeExit(
  trade: TradeSnapshot,
  exitPrice: number,
  reason: CloseTradeInput["reason"],
  closedAt: number,
): ExitInfo {
  const sign = trade.direction === "LONG" ? 1 : -1;
  const priceDelta = (exitPrice - trade.entryPrice) * sign;
  const pnlUsd = priceDelta * trade.qty;
  const pnlPct = priceDelta / trade.entryPrice;
  const holdingSec = Math.max(0, Math.floor((closedAt - trade.openedAt) / 1000));

  let rMultiple: number | undefined;
  if (trade.riskAmountUsd > 0) {
    rMultiple = pnlUsd / trade.riskAmountUsd;
  }

  return {
    closedAt,
    exitPrice,
    reason,
    pnlUsd,
    pnlPct,
    holdingSec,
    rMultiple,
  };
}

// ═══════════════ EQUITY HALT — STATE MACHINE GUARD ═══════════════

/**
 * Equity curve durumundan halt state hesapla.
 *
 * Split-Brain koruması: bu fonksiyon her state machine geçişinden önce
 * çağrılabilir. Halt aktifse yeni geçişler reddedilir.
 */
export function computeEquityHaltState(
  curve: EquityCurveInput,
): EquityHaltState {
  const decision = computeEquityCurveDecision(curve);

  if (decision.tier !== "locked") {
    return { active: false, reason: null, triggeredAt: null, label: "Normal" };
  }

  const reason: EquityHaltReason =
    decision.triggeredBy === "monthly" ? "monthly_locked" : "weekly_locked";

  return {
    active: true,
    reason,
    triggeredAt: Date.now(),
    label: decision.label,
  };
}

/**
 * Split-Brain Guard — Equity halt aktifken yeni pending→open geçişini engelle.
 *
 * Senaryo: trade pending durumda iken haftalık/aylık kilit devreye girdiyse,
 * confirmOpen çağrısını reddet. Bu "split-brain" durumunu önler:
 * borsada emir gönderilmiş ama sistem kilit durumunda → state machine hata verir,
 * caller rollback yapmalı.
 *
 * @throws Error eğer equity halt aktifse
 */
export function guardAgainstEquityHalt(
  trade: TradeSnapshot,
  haltState: EquityHaltState,
): void {
  if (!haltState.active) return;
  throw new Error(
    `guardAgainstEquityHalt: equity halt active (${haltState.reason}) — ` +
      `cannot transition trade ${trade.id} (${trade.status}). ` +
      `Caller must cancel/rollback the order.`,
  );
}

/**
 * Equity halt tetiklendiğinde tüm açık/bekleyen trade'leri zorla kapat.
 *
 * Her trade için mevcut fiyatı exit price olarak kullanır (gerçek P&L hesabı
 * için caller livePrice geçirir). reason = "equity_halt".
 *
 * Immutability: closed trade'ler dokunulmaz geçer.
 *
 * @param trades     Mevcut trade listesi
 * @param livePrice  Anlık fiyat (pair bazlı; caller pair kontrolü yapar)
 * @param now        Zaman (test injection için)
 * @returns          Güncellenmiş trade listesi (yeni nesneler, orijinal değişmez)
 */
export function forceCloseAllForEquityHalt(
  trades: readonly TradeSnapshot[],
  livePrice: number,
  now: number = Date.now(),
): TradeSnapshot[] {
  return trades.map((trade) => {
    if (trade.status === "closed") return trade;
    const exit = computeExit(trade, livePrice, "equity_halt", now);
    return { ...trade, status: "closed", exit };
  });
}

// ═══════════════ TP/SL HIT DETECTION ═══════════════

/**
 * Mevcut fiyatla TP veya SL'e değildi mi kontrol et.
 *
 * - LONG: high >= TP → TP hit, low <= SL → SL hit
 * - SHORT: low <= TP → TP hit, high >= SL → SL hit
 *
 * @returns null → henüz tetiklenmedi; "tp1"/"tp2"/"sl" → tetiklendi
 *
 * NOT: Bu fonksiyon polling tabanlı — gerçek borsada exchange tarafı zaten
 * tetikler. Bizim için TP/SL hit'i tespit etmek = trade'i kapatmak.
 */
export function detectTpSlHit(
  trade: TradeSnapshot,
  high: number,
  low: number,
): { reason: "tp1" | "tp2" | "sl"; price: number } | null {
  if (trade.status !== "open") return null;

  const isLong = trade.direction === "LONG";

  // SL check (always first — risk first)
  if (isLong && low <= trade.stopPrice) {
    return { reason: "sl", price: trade.stopPrice };
  }
  if (!isLong && high >= trade.stopPrice) {
    return { reason: "sl", price: trade.stopPrice };
  }

  // TP1 check
  if (trade.takeProfit1 !== undefined) {
    if (isLong && high >= trade.takeProfit1) {
      // TP2 öncelikli mi (high TP2'ye de değdi mi)
      if (
        trade.takeProfit2 !== undefined &&
        high >= trade.takeProfit2
      ) {
        return { reason: "tp2", price: trade.takeProfit2 };
      }
      return { reason: "tp1", price: trade.takeProfit1 };
    }
    if (!isLong && low <= trade.takeProfit1) {
      if (
        trade.takeProfit2 !== undefined &&
        low <= trade.takeProfit2
      ) {
        return { reason: "tp2", price: trade.takeProfit2 };
      }
      return { reason: "tp1", price: trade.takeProfit1 };
    }
  }

  return null;
}
