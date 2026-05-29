/**
 * DYNAMIC SLIPPAGE GUARD — Akıllı Emir Dönüştürücü.
 *
 * Piyasa koşullarını (ATR volatilite rejimi + emir defteri derinliği) anlık
 * değerlendirerek en uygun emir tipini belirler.
 *
 * Karar matrisi:
 *   slippageRiskScore 0–39  → MARKET  (likidite yeterli, volatilite düşük)
 *   slippageRiskScore 40–69 → LIMIT   (orta risk, limit fill kabul edilebilir)
 *   slippageRiskScore 70–100→ POST_ONLY (yüksek risk, maker guarantee)
 *
 * Slippage risk skoru:
 *   atrScore    = f(atrPercentile)   — volatilite bileşeni (0–60)
 *   depthScore  = f(depthNotional)   — likidite bileşeni (0–40)
 *   total       = atrScore + depthScore
 *
 * Limit fiyat hesabı:
 *   LONG  → best ask - offset (aggressive limit — hemen dolma ihtimali yüksek)
 *   SHORT → best bid + offset
 *   Post-Only: aynı fiyat ama maker-only flag ile (borsa daha iyi fiyat garantisi)
 *
 * Tüm fonksiyonlar saf (pure) — I/O yok.
 *
 * OKX API ordType referansı:
 *   "market"    — market order (slippage riski var)
 *   "limit"     — limit order (taker olabilir)
 *   "post_only" — maker-only, taker olursa iptal edilir
 */

import type { Pair } from "@/lib/constants/pairs";
import type { OrderBookSnapshot } from "@/lib/orderflow/orderbook";

// ─── Sabitler ────────────────────────────────────────────────

export const SLIPPAGE_GUARD_DEFAULTS = {
  /** ATR percentile üzerinde = volatilite "yüksek" sayılır */
  ATR_HIGH_THRESHOLD: 75,
  /** ATR percentile üzerinde = volatilite "çok yüksek" (post_only zorlar) */
  ATR_EXTREME_THRESHOLD: 90,
  /** MARKET/LIMIT karar sınırı */
  RISK_LIMIT_THRESHOLD: 40,
  /** LIMIT/POST_ONLY karar sınırı */
  RISK_POSTONLY_THRESHOLD: 70,
  /** Limit fiyat = en iyi ask/bid ± bu offset oranı */
  LIMIT_OFFSET_PCT: 0.0002,
  /** OB derinlik analizi için üst N seviye */
  DEPTH_TOP_N: 5,
  /** BTC için eşik notional (USD) — yetersiz likidite sınırı */
  MIN_DEPTH_BTC_USD: 500_000,
  /** ETH için eşik notional (USD) */
  MIN_DEPTH_ETH_USD: 200_000,
  /** Diğer pair'ler için varsayılan eşik */
  MIN_DEPTH_DEFAULT_USD: 300_000,
} as const;

// ─── Tipler ──────────────────────────────────────────────────

export type ExecutionOrderType = "market" | "limit" | "post_only";

export type SlippageGuardConfig = {
  ATR_HIGH_THRESHOLD?: number;
  ATR_EXTREME_THRESHOLD?: number;
  RISK_LIMIT_THRESHOLD?: number;
  RISK_POSTONLY_THRESHOLD?: number;
  LIMIT_OFFSET_PCT?: number;
  DEPTH_TOP_N?: number;
  MIN_DEPTH_BTC_USD?: number;
  MIN_DEPTH_ETH_USD?: number;
  MIN_DEPTH_DEFAULT_USD?: number;
};

export interface SlippageGuardInput {
  pair: Pair;
  direction: "LONG" | "SHORT";
  /** ATR percentile rank (0–100). null → bilinmiyor, risk bileşeni atlanır */
  atrPercentile: number | null;
  /** Anlık emir defteri snapshot. null → bilinmiyor, depth bileşeni atlanır */
  orderBook: OrderBookSnapshot | null;
  /** Konfig override (opsiyonel) */
  config?: SlippageGuardConfig;
}

export interface SlippageGuardDecision {
  /** Önerilen emir tipi */
  ordType: ExecutionOrderType;
  /**
   * Limit/Post-Only için fiyat. Market için null.
   * LONG: en iyi ask - offset; SHORT: en iyi bid + offset
   */
  limitPrice: number | null;
  /** Bileşik risk skoru (0–100) */
  slippageRiskScore: number;
  /** ATR bileşeni (0–60) */
  atrRiskScore: number;
  /** Derinlik bileşeni (0–40) */
  depthRiskScore: number;
  /** İnsan-okunabilir karar gerekçesi */
  reason: string;
  /** Giriş özeti (loglama için) */
  diagnostics: {
    atrPercentile: number | null;
    depthNotionalUsd: number | null;
    bestBid: number | null;
    bestAsk: number | null;
  };
}

// ─── Yardımcı hesaplar ────────────────────────────────────────

/**
 * ATR percentile → risk skoru (0–60).
 *
 * < HIGH_THRESHOLD → linear artış (0–30)
 * HIGH–EXTREME    → linear artış (30–50)
 * > EXTREME       → linear artış (50–60)
 */
function computeAtrRiskScore(
  atrPercentile: number | null,
  cfg: { ATR_HIGH_THRESHOLD: number; ATR_EXTREME_THRESHOLD: number },
): number {
  if (atrPercentile === null) return 0;
  const pct = Math.max(0, Math.min(100, atrPercentile));

  if (pct < cfg.ATR_HIGH_THRESHOLD) {
    // 0–HIGH_THRESHOLD → 0–30 linear
    return (pct / cfg.ATR_HIGH_THRESHOLD) * 30;
  }
  if (pct < cfg.ATR_EXTREME_THRESHOLD) {
    // HIGH–EXTREME → 30–50 linear
    const ratio =
      (pct - cfg.ATR_HIGH_THRESHOLD) /
      (cfg.ATR_EXTREME_THRESHOLD - cfg.ATR_HIGH_THRESHOLD);
    return 30 + ratio * 20;
  }
  // EXTREME+ → 50–60 linear
  const ratio = Math.min(1, (pct - cfg.ATR_EXTREME_THRESHOLD) / (100 - cfg.ATR_EXTREME_THRESHOLD));
  return 50 + ratio * 10;
}

/**
 * Emir defteri toplam derinliği (ask tarafı için LONG, bid tarafı için SHORT).
 * Üst N seviyedeki notional toplamı döner.
 */
function computeRelevantDepthNotional(
  orderBook: OrderBookSnapshot | null,
  direction: "LONG" | "SHORT",
  topN: number,
): number | null {
  if (!orderBook) return null;
  // LONG alıcısı ask tarafından dolduruyor → ask derinliği önemli
  // SHORT satıcısı bid tarafından dolduruyor → bid derinliği önemli
  const levels =
    direction === "LONG"
      ? orderBook.asks.slice(0, topN)
      : orderBook.bids.slice(0, topN);

  if (levels.length === 0) return 0;
  let total = 0;
  for (const l of levels) total += l.notionalUsd;
  return total;
}

/**
 * Derinlik notional → risk skoru (0–40).
 *
 * depth ≥ 2× eşik → 0 (likidite bol)
 * depth = eşik     → 20
 * depth = 0        → 40 (sıfır likidite)
 */
function computeDepthRiskScore(
  depthNotional: number | null,
  pair: Pair,
  cfg: { MIN_DEPTH_BTC_USD: number; MIN_DEPTH_ETH_USD: number; MIN_DEPTH_DEFAULT_USD: number },
): number {
  if (depthNotional === null) return 0;

  const threshold =
    pair === "BTC"
      ? cfg.MIN_DEPTH_BTC_USD
      : pair === "ETH"
        ? cfg.MIN_DEPTH_ETH_USD
        : cfg.MIN_DEPTH_DEFAULT_USD;

  const doubleThreshold = threshold * 2;

  if (depthNotional >= doubleThreshold) return 0;
  if (depthNotional <= 0) return 40;

  // Linear: [0, doubleThreshold] → [40, 0]
  return 40 * (1 - depthNotional / doubleThreshold);
}

// ─── Ana karar fonksiyonu ─────────────────────────────────────

/**
 * Volatilite + likidite değerlendirmesine göre emir tipini belirle.
 *
 * Saf fonksiyon — timestamp/random yok, test edilebilir.
 */
// Internal merged config type (numeric, not literal)
interface ResolvedConfig {
  ATR_HIGH_THRESHOLD: number;
  ATR_EXTREME_THRESHOLD: number;
  RISK_LIMIT_THRESHOLD: number;
  RISK_POSTONLY_THRESHOLD: number;
  LIMIT_OFFSET_PCT: number;
  DEPTH_TOP_N: number;
  MIN_DEPTH_BTC_USD: number;
  MIN_DEPTH_ETH_USD: number;
  MIN_DEPTH_DEFAULT_USD: number;
}

export function evaluateSlippageRisk(
  input: SlippageGuardInput,
): SlippageGuardDecision {
  const cfg: ResolvedConfig = { ...SLIPPAGE_GUARD_DEFAULTS, ...input.config };

  const atrRiskScore = computeAtrRiskScore(input.atrPercentile, cfg);

  const depthNotional = computeRelevantDepthNotional(
    input.orderBook,
    input.direction,
    cfg.DEPTH_TOP_N,
  );
  const depthRiskScore = computeDepthRiskScore(depthNotional, input.pair, cfg);

  const slippageRiskScore = Math.min(100, Math.round(atrRiskScore + depthRiskScore));

  // En iyi bid/ask
  const bestBid = input.orderBook?.bids[0]?.price ?? null;
  const bestAsk = input.orderBook?.asks[0]?.price ?? null;

  // Emir tipini belirle
  let ordType: ExecutionOrderType;
  let limitPrice: number | null = null;
  let reason: string;

  if (slippageRiskScore >= cfg.RISK_POSTONLY_THRESHOLD) {
    ordType = "post_only";
    reason = `Yüksek slippage riski (skor=${slippageRiskScore}): ` +
      `ATR%=${input.atrPercentile?.toFixed(0) ?? "N/A"}, ` +
      `derinlik=${depthNotional !== null ? `$${Math.round(depthNotional / 1000)}K` : "N/A"}. ` +
      "Post-Only emre geçildi.";
  } else if (slippageRiskScore >= cfg.RISK_LIMIT_THRESHOLD) {
    ordType = "limit";
    reason = `Orta slippage riski (skor=${slippageRiskScore}): Limit emre geçildi.`;
  } else {
    ordType = "market";
    reason = `Düşük slippage riski (skor=${slippageRiskScore}): Market emri güvenli.`;
  }

  // Limit fiyat hesabı
  if (ordType !== "market") {
    if (input.direction === "LONG" && bestAsk !== null) {
      // Agresif limit: ask'ın biraz altı — taker olarak dolma ihtimali yüksek
      limitPrice = parseFloat((bestAsk * (1 - cfg.LIMIT_OFFSET_PCT)).toFixed(2));
    } else if (input.direction === "SHORT" && bestBid !== null) {
      limitPrice = parseFloat((bestBid * (1 + cfg.LIMIT_OFFSET_PCT)).toFixed(2));
    }
    // Fiyat yoksa limit/post_only'ye geçilse bile market'a düş
    if (limitPrice === null) {
      ordType = "market";
      reason += " (OB fiyatı alınamadı → market fallback)";
    }
  }

  return {
    ordType,
    limitPrice,
    slippageRiskScore,
    atrRiskScore: Math.round(atrRiskScore),
    depthRiskScore: Math.round(depthRiskScore),
    reason,
    diagnostics: {
      atrPercentile: input.atrPercentile,
      depthNotionalUsd: depthNotional,
      bestBid,
      bestAsk,
    },
  };
}

// ─── Adapter entegrasyon yardımcısı ──────────────────────────

/**
 * OKX adapter'ına gönderilecek ordType ve px değerlerini üret.
 *
 * OKX API:
 *   market    → ordType="market", px yok
 *   limit     → ordType="limit", px=limitPrice
 *   post_only → ordType="post_only", px=limitPrice
 *
 * @returns { ordType: string; px: string | undefined }
 */
export function toOkxOrderParams(decision: SlippageGuardDecision): {
  ordType: string;
  px: string | undefined;
} {
  if (decision.ordType === "market") {
    return { ordType: "market", px: undefined };
  }
  return {
    ordType: decision.ordType === "post_only" ? "post_only" : "limit",
    px: decision.limitPrice !== null ? String(decision.limitPrice) : undefined,
  };
}

// ─── Toplu batch değerlendirme (çok pair'li sistemler için) ───

/**
 * Birden fazla pair için aynı anda slippage değerlendirmesi.
 * Her pair için bağımsız karar verilir.
 */
export function evaluateBatch(
  inputs: SlippageGuardInput[],
): SlippageGuardDecision[] {
  return inputs.map(evaluateSlippageRisk);
}
