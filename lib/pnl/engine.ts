/**
 * P&L ENGINE — Kayıpsız finansal hesaplama motoru.
 *
 * Sorumluluklar:
 *   1. Realized P&L — kapanmış pozisyon, fee düşülmüş net kâr/zarar
 *   2. Unrealized P&L — açık pozisyon, anlık piyasa fiyatına göre kâğıt değeri
 *   3. Equity hesabı — bakiye + tüm açık pozisyonların unrealized toplamı
 *   4. Fee/funding maliyeti — taker fee + günlük funding cost
 *   5. Invariant validators — finansal değişmezlik kuralları
 *
 * Tüm fonksiyonlar safdır (pure) — I/O yok, Date.now() çağrısı yok.
 *
 * Fee modeli (OKX perpetual):
 *   Taker fee: pozisyon değeri × feePct (default %0.05 = 0.0005)
 *   Funding:   pozisyon değeri × fundingRatePct × (holdingHours / 8)
 *              (OKX funding 8 saatte bir ödenir)
 */

import type { TradeSnapshot } from "@/lib/trades/types";
import type { Pair } from "@/lib/constants/pairs";

// ─── Sabitler ────────────────────────────────────────────────

export const FEE_DEFAULTS = {
  /** OKX perpetual taker fee (varsayılan) */
  TAKER_FEE_PCT: 0.0005,
  /** OKX funding periyodu (saat) */
  FUNDING_PERIOD_HOURS: 8,
} as const;

// ─── Tipler ──────────────────────────────────────────────────

export interface FeeInput {
  /** Pozisyon değeri USDT (notional = price × qty) */
  notionalUsd: number;
  /** Taker fee oranı (0.0005 = %0.05) */
  takerFeePct?: number;
  /** Fonlama maliyeti oranı (örn. 0.0001 = %0.01 per 8h) */
  fundingRatePct?: number;
  /** Holding süresi (saat) — funding hesabı için */
  holdingHours?: number;
}

export interface FeeResult {
  /** Giriş + çıkış taker fee toplamı */
  takerFeeUsd: number;
  /** Birikmiş funding maliyeti */
  fundingCostUsd: number;
  /** Toplam maliyet */
  totalFeeUsd: number;
}

export interface RealizedPnlResult {
  /** Brüt P&L (fee öncesi) */
  grossPnlUsd: number;
  /** Net P&L (fee düşülmüş) */
  netPnlUsd: number;
  /** Net P&L yüzdesi (entry notional'a göre) */
  netPnlPct: number;
  /** Hesaplanan fee detayı */
  fees: FeeResult;
  /** R-multiple (netPnl / riskAmount) */
  rMultiple: number | null;
}

export interface UnrealizedPnlResult {
  /** Brüt unrealized P&L */
  grossUnrealizedUsd: number;
  /** Net unrealized P&L (accrued fee düşülmüş) */
  netUnrealizedUsd: number;
  /** Net yüzde (entry notional'a göre) */
  netUnrealizedPct: number;
  /** Anlık piyasa fiyatı */
  livePrice: number;
  /** Birikmiş fee */
  fees: FeeResult;
}

export interface OpenPositionSummary {
  pair: Pair;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  qty: number;
  unrealizedUsd: number;
}

export interface EquityResult {
  /** Borsa bakiyesi (serbest + teminat) */
  balanceUsd: number;
  /** Tüm açık pozisyonların net unrealized toplamı */
  totalUnrealizedUsd: number;
  /** Kasa değeri: balance + unrealized */
  equityUsd: number;
  /** Pozisyon bazlı özet */
  positions: OpenPositionSummary[];
}

// ─── Fee Hesabı ──────────────────────────────────────────────

/**
 * Giriş + çıkış taker fee + funding cost hesapla.
 *
 * Taker fee: giriş × rate + çıkış × rate = 2 × notional × rate
 * Funding: notional × fundingRate × (holdingHours / 8)
 */
export function computeFee(input: FeeInput): FeeResult {
  const feePct = input.takerFeePct ?? FEE_DEFAULTS.TAKER_FEE_PCT;
  // Her iki tarafta da (giriş + çıkış) taker fee ödenir
  const takerFeeUsd = input.notionalUsd * feePct * 2;

  let fundingCostUsd = 0;
  if (
    input.fundingRatePct !== undefined &&
    input.fundingRatePct !== 0 &&
    input.holdingHours !== undefined &&
    input.holdingHours > 0
  ) {
    const periods = input.holdingHours / FEE_DEFAULTS.FUNDING_PERIOD_HOURS;
    fundingCostUsd = input.notionalUsd * Math.abs(input.fundingRatePct) * periods;
  }

  return {
    takerFeeUsd,
    fundingCostUsd,
    totalFeeUsd: takerFeeUsd + fundingCostUsd,
  };
}

// ─── Realized P&L ────────────────────────────────────────────

/**
 * Kapanmış trade için net realized P&L.
 *
 * Gereksinim: trade.status === "closed" ve trade.exit dolu olmalı.
 * Aksi hâlde null döner.
 */
export function computeRealizedPnl(
  trade: TradeSnapshot,
  opts: {
    takerFeePct?: number;
    fundingRatePct?: number;
  } = {},
): RealizedPnlResult | null {
  if (trade.status !== "closed" || !trade.exit) return null;

  const notionalUsd = trade.entryPrice * trade.qty;
  const grossPnlUsd = trade.exit.pnlUsd;
  const holdingHours = trade.exit.holdingSec / 3600;

  const fees = computeFee({
    notionalUsd,
    takerFeePct: opts.takerFeePct,
    fundingRatePct: opts.fundingRatePct,
    holdingHours,
  });

  const netPnlUsd = grossPnlUsd - fees.totalFeeUsd;
  const netPnlPct = notionalUsd > 0 ? netPnlUsd / notionalUsd : 0;

  const rMultiple =
    trade.riskAmountUsd > 0 ? netPnlUsd / trade.riskAmountUsd : null;

  return { grossPnlUsd, netPnlUsd, netPnlPct, fees, rMultiple };
}

// ─── Unrealized P&L ──────────────────────────────────────────

/**
 * Açık pozisyon için net unrealized P&L.
 *
 * Gereksinim: trade.status === "open".
 * Aksi hâlde null döner.
 *
 * @param trade      Açık trade snapshot
 * @param livePrice  Anlık piyasa fiyatı
 * @param nowMs      Şu anki zaman (holding süresi için)
 * @param opts       Fee parametreleri
 */
export function computeUnrealizedPnl(
  trade: TradeSnapshot,
  livePrice: number,
  nowMs: number,
  opts: {
    takerFeePct?: number;
    fundingRatePct?: number;
  } = {},
): UnrealizedPnlResult | null {
  if (trade.status !== "open") return null;
  if (livePrice <= 0) return null;

  const notionalUsd = trade.entryPrice * trade.qty;
  const sign = trade.direction === "LONG" ? 1 : -1;
  const grossUnrealizedUsd = (livePrice - trade.entryPrice) * sign * trade.qty;

  const holdingHours = Math.max(0, (nowMs - trade.openedAt) / 3_600_000);
  const fees = computeFee({
    notionalUsd,
    takerFeePct: opts.takerFeePct,
    fundingRatePct: opts.fundingRatePct,
    holdingHours,
  });

  const netUnrealizedUsd = grossUnrealizedUsd - fees.totalFeeUsd;
  const netUnrealizedPct = notionalUsd > 0 ? netUnrealizedUsd / notionalUsd : 0;

  return { grossUnrealizedUsd, netUnrealizedUsd, netUnrealizedPct, livePrice, fees };
}

// ─── Equity ──────────────────────────────────────────────────

/**
 * Kasa değeri hesabı — bakiye + tüm açık pozisyonların unrealized toplamı.
 *
 * @param balanceUsd  Serbest + teminat bakiye toplamı
 * @param openTrades  Açık trade'ler (status==="open" olanlar otomatik filtreler)
 * @param livePrices  Pair → anlık fiyat
 * @param nowMs       Şu anki zaman
 * @param opts        Fee parametreleri
 */
export function computeEquity(
  balanceUsd: number,
  openTrades: readonly TradeSnapshot[],
  livePrices: Partial<Record<Pair, number>>,
  nowMs: number,
  opts: { takerFeePct?: number; fundingRatePct?: number } = {},
): EquityResult {
  const positions: OpenPositionSummary[] = [];
  let totalUnrealizedUsd = 0;

  for (const trade of openTrades) {
    if (trade.status !== "open") continue;
    const livePrice = livePrices[trade.pair];
    if (!livePrice || livePrice <= 0) continue;

    const unrealized = computeUnrealizedPnl(trade, livePrice, nowMs, opts);
    if (!unrealized) continue;

    totalUnrealizedUsd += unrealized.netUnrealizedUsd;
    positions.push({
      pair: trade.pair,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      qty: trade.qty,
      unrealizedUsd: unrealized.netUnrealizedUsd,
    });
  }

  const equityUsd = balanceUsd + totalUnrealizedUsd;

  return { balanceUsd, totalUnrealizedUsd, equityUsd, positions };
}

// ─── Invariant Validators ─────────────────────────────────────

/**
 * INVARIANT 1 — Kasa hiçbir koşulda negatife düşemez.
 *
 * Equity < 0 ise Error fırlatır.
 * Caller bu fonksiyonu her equity hesabından sonra çağırmalıdır.
 *
 * @throws {InvariantError} equity < 0 ise
 */
export function assertEquityNonNegative(equityUsd: number): void {
  if (equityUsd < 0) {
    throw new InvariantError(
      `INVARIANT VIOLATION: Equity ${equityUsd.toFixed(4)} USD < 0. ` +
        "System must halt new positions immediately.",
    );
  }
}

/**
 * INVARIANT 2 — SL seviyesi geçerli mi?
 *
 * LONG:  slPrice < entryPrice  (stop loss giriş fiyatının altında)
 * SHORT: slPrice > entryPrice  (stop loss giriş fiyatının üstünde)
 *
 * Trailing stop durumu hariç — bu fonksiyon yalnızca pozisyon açılış anı
 * için ilk kurulum geçerliliğini kontrol eder.
 *
 * @throws {InvariantError} SL geçersizse
 */
export function assertSlValid(
  entryPrice: number,
  slPrice: number,
  direction: "LONG" | "SHORT",
): void {
  if (direction === "LONG" && slPrice >= entryPrice) {
    throw new InvariantError(
      `INVARIANT VIOLATION: LONG SL (${slPrice}) >= entry (${entryPrice}). ` +
        "Stop-loss must be BELOW entry for LONG positions.",
    );
  }
  if (direction === "SHORT" && slPrice <= entryPrice) {
    throw new InvariantError(
      `INVARIANT VIOLATION: SHORT SL (${slPrice}) <= entry (${entryPrice}). ` +
        "Stop-loss must be ABOVE entry for SHORT positions.",
    );
  }
}

/**
 * Soft version — throw yerine boolean döner (UI kontrolleri için).
 */
export function isSlValid(
  entryPrice: number,
  slPrice: number,
  direction: "LONG" | "SHORT",
): boolean {
  try {
    assertSlValid(entryPrice, slPrice, direction);
    return true;
  } catch {
    return false;
  }
}

/**
 * Soft equity check — throw yerine boolean.
 */
export function isEquityNonNegative(equityUsd: number): boolean {
  return equityUsd >= 0;
}

// ─── Özel hata sınıfı ────────────────────────────────────────

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}
