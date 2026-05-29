/**
 * TRADE SELECTORS — Filtreleme + sıralama yardımcıları.
 *
 * Saf fonksiyonlar — UI ve store store'lardan çağrılır.
 */

import type { Pair } from "@/lib/constants/pairs";
import type { TradeSnapshot, TradeStatus } from "./types";

export function filterByStatus(
  trades: readonly TradeSnapshot[],
  status: TradeStatus,
): TradeSnapshot[] {
  return trades.filter((t) => t.status === status);
}

export function filterByPair(
  trades: readonly TradeSnapshot[],
  pair: Pair,
): TradeSnapshot[] {
  return trades.filter((t) => t.pair === pair);
}

export function filterOpen(trades: readonly TradeSnapshot[]): TradeSnapshot[] {
  return filterByStatus(trades, "open");
}

export function filterClosed(
  trades: readonly TradeSnapshot[],
): TradeSnapshot[] {
  return filterByStatus(trades, "closed");
}

/**
 * Sıralama: en yeni önce (entry timestamp desc).
 */
export function sortByOpenedDesc(
  trades: readonly TradeSnapshot[],
): TradeSnapshot[] {
  return [...trades].sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * Son N trade (en yeni N tane).
 */
export function recentTrades(
  trades: readonly TradeSnapshot[],
  n: number,
): TradeSnapshot[] {
  return sortByOpenedDesc(trades).slice(0, n);
}

/**
 * Bugün açılmış trade sayısı (max-per-day kontrolü için).
 *
 * Default timezone: kullanıcının yerel saat dilimi.
 */
export function countTradesToday(
  trades: readonly TradeSnapshot[],
  now: number = Date.now(),
): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  return trades.filter((t) => t.openedAt >= dayStart).length;
}

/**
 * Status'a göre breakdown — UI özet kartı için.
 */
export function statusBreakdown(
  trades: readonly TradeSnapshot[],
): Record<TradeStatus, number> {
  return {
    pending: trades.filter((t) => t.status === "pending").length,
    open: trades.filter((t) => t.status === "open").length,
    closed: trades.filter((t) => t.status === "closed").length,
  };
}
