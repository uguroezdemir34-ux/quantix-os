/**
 * P&L SOURCES — Trade verisi nereden geliyor?
 *
 * Şu an: DisciplineLog'un `trade_close` event'lerinden türetilir.
 * Gelecek (paket #14): Dedicated TradeSnapshot store.
 *
 * DisciplineEntry yapısı:
 *   ts: number
 *   type: 'trade_close' | 'trade_open' | ...
 *   pair?: string
 *   direction?: string
 *   pnl?: number  (kapanış)
 *   pnlPct?: number
 *   reason?: string  ('tp1'|'tp2'|'sl'|'manual')
 *   ...
 */

import type { DisciplineEntry } from "@/lib/risk/discipline-log";
import type { TradeRecord } from "./types";

/**
 * DisciplineEntry → TradeRecord (eğer trade_close event'i ise).
 *
 * pair veya pnl yoksa null döner (eksik veri).
 */
export function entryToTradeRecord(
  entry: DisciplineEntry,
): TradeRecord | null {
  if (entry.type !== "trade_close") return null;

  const pair = entry.pair;
  if (pair !== "BTC" && pair !== "ETH") return null;

  const pnl = entry.pnl;
  if (typeof pnl !== "number") return null;

  const direction = entry.direction;
  if (direction !== "LONG" && direction !== "SHORT") return null;

  const closeReason = parseCloseReason(entry.reason);

  return {
    closedAt: entry.ts,
    pair,
    direction,
    pnlUsd: pnl,
    pnlPct: typeof entry.pnlPct === "number" ? entry.pnlPct : undefined,
    score: typeof entry.score === "number" ? entry.score : undefined,
    closeReason,
    isPaper: typeof entry.isPaper === "boolean" ? entry.isPaper : undefined,
  };
}

/**
 * DisciplineLog entries → TradeRecord list.
 * Filtreler: sadece trade_close + geçerli verisi olanlar.
 */
export function entriesToTrades(
  entries: readonly DisciplineEntry[],
): TradeRecord[] {
  const result: TradeRecord[] = [];
  for (const e of entries) {
    const r = entryToTradeRecord(e);
    if (r !== null) result.push(r);
  }
  return result;
}

function parseCloseReason(
  raw: unknown,
): TradeRecord["closeReason"] | undefined {
  if (typeof raw !== "string") return undefined;
  if (raw === "tp1" || raw === "tp2" || raw === "sl" || raw === "manual" || raw === "trail") {
    return raw;
  }
  return undefined;
}
