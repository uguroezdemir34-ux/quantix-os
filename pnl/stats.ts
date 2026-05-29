/**
 * P&L STATS — Trade list → genel istatistikler.
 *
 * Saf fonksiyon. Win rate, avg R, profit factor, max drawdown.
 */

import type { TradeRecord, PnlStats, DailyAggregate } from "./types";
import { computeDailyAggregates } from "./compute";

/**
 * Boş stats (hiç trade yokken default değerler).
 */
export function emptyPnlStats(): PnlStats {
  return {
    totalTrades: 0,
    totalPnlUsd: 0,
    totalPnlPct: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    avgR: null,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: null,
    maxDrawdownUsd: 0,
    bestDay: null,
    worstDay: null,
  };
}

/**
 * Trade list → istatistikler.
 */
export function computePnlStats(
  trades: readonly TradeRecord[],
  tzOffsetMin?: number,
): PnlStats {
  if (trades.length === 0) return emptyPnlStats();

  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  // pnl === 0 (breakeven) ne win ne loss

  const winCount = wins.length;
  const lossCount = losses.length;
  const totalTrades = trades.length;

  const totalPnlUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  const winRate = totalTrades === 0 ? 0 : winCount / totalTrades;

  // avg R = avg win / avg loss (mutlak değer)
  let avgR: number | null = null;
  if (winCount > 0 && lossCount > 0) {
    const avgWin = grossProfit / winCount;
    const avgLoss = grossLoss / lossCount;
    if (avgLoss > 0) {
      avgR = avgWin / avgLoss;
    }
  }

  // Profit factor — sadece HEM kazanç HEM kayıp varsa anlamlı
  let profitFactor: number | null = null;
  if (grossProfit > 0 && grossLoss > 0) {
    profitFactor = grossProfit / grossLoss;
  } else if (grossProfit > 0 && grossLoss === 0) {
    profitFactor = Infinity; // hiç kayıp yoksa
  }
  // grossProfit === 0 && grossLoss > 0 → null (kazanç hiç yok, faktör tanımsız)

  // Total P&L pct = trade pct'lerin basit ortalaması
  const tradesWithPct = trades.filter((t) => typeof t.pnlPct === "number");
  const totalPnlPct =
    tradesWithPct.length === 0
      ? 0
      : tradesWithPct.reduce((s, t) => s + (t.pnlPct ?? 0), 0);

  // Max drawdown (peak-to-trough)
  const maxDrawdownUsd = computeMaxDrawdown(trades);

  // Best/worst day
  const dailyAggs = computeDailyAggregates(trades, tzOffsetMin);
  let bestDay: DailyAggregate | null = null;
  let worstDay: DailyAggregate | null = null;
  for (const d of dailyAggs) {
    if (bestDay === null || d.totalPnlUsd > bestDay.totalPnlUsd) bestDay = d;
    if (worstDay === null || d.totalPnlUsd < worstDay.totalPnlUsd) worstDay = d;
  }

  return {
    totalTrades,
    totalPnlUsd,
    totalPnlPct,
    winCount,
    lossCount,
    winRate,
    avgR,
    grossProfit,
    grossLoss,
    profitFactor,
    maxDrawdownUsd,
    bestDay,
    worstDay,
  };
}

/**
 * Max drawdown (peak-to-trough) — kronolojik sırada cumulative P&L
 * curve'unun en büyük "düşüş"ü.
 */
function computeMaxDrawdown(trades: readonly TradeRecord[]): number {
  if (trades.length === 0) return 0;
  // Kronolojik sıra
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  let peak = 0;
  let cumulative = 0;
  let maxDd = 0;
  for (const t of sorted) {
    cumulative += t.pnlUsd;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * Filtre — sadece son N gün.
 */
export function filterLastNDays(
  trades: readonly TradeRecord[],
  days: number,
  now: number = Date.now(),
): TradeRecord[] {
  const cutoff = now - days * 86_400_000;
  return trades.filter((t) => t.closedAt >= cutoff);
}
