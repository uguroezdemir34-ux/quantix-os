/**
 * P&L TYPES — Trade kaydı, günlük toplam, istatistikler.
 *
 * Saf veri tipi modülü — fonksiyon yok.
 */

import type { Pair } from "@/lib/constants/pairs";

// ═══════════════ TRADE RECORD ═══════════════

/**
 * Tek trade kaydı — açılış + kapanış birlikte.
 *
 * Şu an DisciplineLog'un trade_close event'lerinden türetilir
 * (paket #14'te dedicated TradeSnapshot store olacak).
 */
export interface TradeRecord {
  /** Kapanış zamanı (epoch ms) — gün gruplaması bunla yapılır */
  closedAt: number;
  /** Açılış zamanı (varsa, holding süresi için) */
  openedAt?: number;
  pair: Pair;
  direction: "LONG" | "SHORT";
  /** P&L USDT cinsinden, signed (+ kazanç, - kayıp) */
  pnlUsd: number;
  /** P&L yüzde (entry'e göre, signed) — örn. 0.025 = +2.5% */
  pnlPct?: number;
  /** Score (verdict_go anındaki skor, varsa) */
  score?: number;
  /** Kapanış sebebi */
  closeReason?: "tp1" | "tp2" | "sl" | "manual" | "trail";
  /** Forward test (kağıt) mı, gerçek mi? */
  isPaper?: boolean;
}

// ═══════════════ DAILY AGGREGATE ═══════════════

/**
 * Tek günün özeti — calendar matrisi için.
 */
export interface DailyAggregate {
  /** Tarih "YYYY-MM-DD" — yerel timezone'da hesaplanır */
  date: string;
  /** Gün başlangıcı epoch ms (yerel timezone) */
  dayStart: number;
  /** O gün kapanan trade sayısı */
  tradeCount: number;
  /** O gün toplam P&L USDT */
  totalPnlUsd: number;
  /** O gün ortalama % P&L (basit ortalama) */
  avgPnlPct: number;
  /** Win sayısı (pnlUsd > 0) */
  winCount: number;
  /** Loss sayısı (pnlUsd < 0) */
  lossCount: number;
  /** Win rate 0-1 */
  winRate: number;
}

// ═══════════════ STATS ═══════════════

/**
 * Genel istatistikler — bir dönemin (örn. son 30 gün) özeti.
 */
export interface PnlStats {
  /** Toplam trade sayısı */
  totalTrades: number;
  /** Toplam P&L USDT */
  totalPnlUsd: number;
  /** Toplam P&L yüzdesi (basit ortalama trade pct'lerin) */
  totalPnlPct: number;
  /** Kazanan trade sayısı */
  winCount: number;
  /** Kaybeden trade sayısı */
  lossCount: number;
  /** Win rate 0-1 (0.0 = hiç kazanılmamış) */
  winRate: number;
  /** Ortalama R (ortalama kazanan / ortalama kaybeden mutlak değer) */
  avgR: number | null;
  /** Toplam kazanç USDT (sadece pozitifler) */
  grossProfit: number;
  /** Toplam kayıp USDT (sadece negatifler, mutlak) */
  grossLoss: number;
  /** Profit factor (grossProfit / grossLoss) */
  profitFactor: number | null;
  /** Max drawdown USDT (peak-to-trough) */
  maxDrawdownUsd: number;
  /** En iyi gün */
  bestDay: DailyAggregate | null;
  /** En kötü gün */
  worstDay: DailyAggregate | null;
}

// ═══════════════ STAT TIER (UI renk için) ═══════════════

/**
 * Win rate tier — UI rengi.
 *  excellent: ≥ 60%
 *  good: 50-60%
 *  fair: 40-50%
 *  poor: < 40%
 */
export type StatTier = "excellent" | "good" | "fair" | "poor";

export function winRateTier(winRate: number): StatTier {
  if (winRate >= 0.6) return "excellent";
  if (winRate >= 0.5) return "good";
  if (winRate >= 0.4) return "fair";
  return "poor";
}
