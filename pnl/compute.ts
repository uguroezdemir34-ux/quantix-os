/**
 * P&L COMPUTE — Trade list'i günlük toplama indirir.
 *
 * Saf fonksiyon — input ts ms, output günlük matris.
 *
 * Önemli: Gün ayrımı YEREL timezone'da yapılır (kullanıcı 23:55'te
 * trade açıp 00:05'te kapatsa, kapanış günü kullanıcının gözünden o gece).
 */

import type { TradeRecord, DailyAggregate } from "./types";

/**
 * Bir epoch ms'i yerel günün başlangıcına yuvarla.
 *
 * Örnek: 2024-01-15 14:32:00 UTC+3 → 2024-01-15 00:00:00 UTC+3
 */
export function localDayStart(epochMs: number, tzOffsetMin?: number): number {
  const d = new Date(epochMs);
  // Default: işletim sisteminin yerel timezone'u
  // Test'lerde tzOffsetMin override edilebilir
  if (tzOffsetMin === undefined) {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  // tzOffsetMin: dakika cinsinden offset (örn. UTC+3 = -180 JS convention, ama biz
  // basitlik için TR convention: UTC+3 = +180)
  const utcMs = epochMs + tzOffsetMin * 60_000;
  const utcDay = Math.floor(utcMs / 86_400_000) * 86_400_000;
  return utcDay - tzOffsetMin * 60_000;
}

/**
 * "YYYY-MM-DD" formatlı tarih string.
 * UTC bazlı — tzOffsetMin verilirse o offset'e göre.
 */
export function formatDateKey(epochMs: number, tzOffsetMin?: number): string {
  let d: Date;
  if (tzOffsetMin === undefined) {
    d = new Date(epochMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  d = new Date(epochMs + tzOffsetMin * 60_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Trade list → günlük agg array.
 *
 * Boş trade list → boş array.
 * Sıralama: tarih artan.
 */
export function computeDailyAggregates(
  trades: readonly TradeRecord[],
  tzOffsetMin?: number,
): DailyAggregate[] {
  if (trades.length === 0) return [];

  // Günlere grupla
  const byDay = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const key = formatDateKey(t.closedAt, tzOffsetMin);
    const arr = byDay.get(key);
    if (arr) {
      arr.push(t);
    } else {
      byDay.set(key, [t]);
    }
  }

  const result: DailyAggregate[] = [];
  for (const [date, dayTrades] of byDay) {
    const totalPnlUsd = dayTrades.reduce((s, t) => s + t.pnlUsd, 0);
    const winCount = dayTrades.filter((t) => t.pnlUsd > 0).length;
    const lossCount = dayTrades.filter((t) => t.pnlUsd < 0).length;
    const tradesWithPct = dayTrades.filter(
      (t) => typeof t.pnlPct === "number",
    );
    const avgPnlPct =
      tradesWithPct.length === 0
        ? 0
        : tradesWithPct.reduce((s, t) => s + (t.pnlPct ?? 0), 0) /
          tradesWithPct.length;
    const winRate =
      dayTrades.length === 0 ? 0 : winCount / dayTrades.length;
    const dayStart = localDayStart(dayTrades[0].closedAt, tzOffsetMin);
    result.push({
      date,
      dayStart,
      tradeCount: dayTrades.length,
      totalPnlUsd,
      avgPnlPct,
      winCount,
      lossCount,
      winRate,
    });
  }

  // Tarih artan sıralama
  result.sort((a, b) => a.dayStart - b.dayStart);
  return result;
}

/**
 * Son N günü doldur — eksik günler "boş" agg ile.
 * Calendar matrisi için gerekli (boş günleri göstermek için).
 */
export function fillMissingDays(
  aggregates: readonly DailyAggregate[],
  endDate: number,
  daysBack: number,
  tzOffsetMin?: number,
): DailyAggregate[] {
  const byDate = new Map<string, DailyAggregate>();
  for (const a of aggregates) {
    byDate.set(a.date, a);
  }

  const result: DailyAggregate[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const dayMs = endDate - i * 86_400_000;
    const dateKey = formatDateKey(dayMs, tzOffsetMin);
    const existing = byDate.get(dateKey);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        date: dateKey,
        dayStart: localDayStart(dayMs, tzOffsetMin),
        tradeCount: 0,
        totalPnlUsd: 0,
        avgPnlPct: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
      });
    }
  }

  return result;
}
