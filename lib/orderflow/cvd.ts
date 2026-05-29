/**
 * CUMULATIVE VOLUME DELTA (CVD) — Sierra Chart'ın imza sinyali.
 *
 * Tanım: CVD = sum(buyNotional) - sum(sellNotional) over a time window
 *
 * Yorumlama:
 *   - CVD pozitif = alıcı baskısı (market buy > market sell)
 *   - CVD negatif = satıcı baskısı (market sell > market buy)
 *   - CVD trend (artış/azalış) = momentum
 *
 * Window stratejisi:
 *   - Çoklu pencere: 1dk (anlık), 5dk (kısa vadeli), 15dk (orta vadeli)
 *   - Pencere kısaltıkça volatilite artar, gürültü artar
 *   - 5dk genelde "sweet spot" karar engine için
 *
 * Threshold (BTC için, USDT cinsinden):
 *   - |CVD| < 100k: nötr
 *   - |CVD| 100k-500k: hafif
 *   - |CVD| 500k-2M: güçlü
 *   - |CVD| > 2M: çok güçlü
 *
 * Bu eşikler BTC-USDT-SWAP için. ETH için 1/4 oranında (lower notional).
 */

import type { Trade } from "./types";
import type { Pair } from "@/lib/constants/pairs";

/**
 * CVD seviyesi — yorumlama için kategori.
 */
export type CvdMagnitude = "neutral" | "weak" | "strong" | "extreme";

/**
 * CVD yönü.
 */
export type CvdDirection = "bullish" | "bearish" | "neutral";

/**
 * Tek pencere için CVD sonucu.
 */
export interface CvdWindow {
  /** Pencere uzunluğu ms */
  windowMs: number;
  /** CVD değeri USD (buy - sell notional) */
  cvdUsd: number;
  /** Pencere içindeki trade sayısı */
  tradeCount: number;
  /** Yön: bullish/bearish/neutral */
  direction: CvdDirection;
  /** Büyüklük kategorisi */
  magnitude: CvdMagnitude;
  /** Buy total */
  buyUsd: number;
  /** Sell total */
  sellUsd: number;
}

/**
 * Birden fazla pencere için CVD multi-frame.
 */
export interface CvdMultiFrame {
  pair: Pair;
  /** 1dk pencere */
  w1m: CvdWindow;
  /** 5dk pencere */
  w5m: CvdWindow;
  /** 15dk pencere */
  w15m: CvdWindow;
  /** Confluence: kaç pencere aynı yönde? (0-3) */
  confluence: number;
  /** Confluence yönü */
  confluenceDirection: CvdDirection;
}

// ════════════════ THRESHOLDS ════════════════

/**
 * BTC için CVD threshold'ları (USD).
 * ETH için 0.25 oranı uygulanır (lower notional).
 */
const BTC_THRESHOLDS = {
  weak: 100_000,
  strong: 500_000,
  extreme: 2_000_000,
} as const;

const ETH_MULTIPLIER = 0.25;

function getThresholds(pair: Pair): {
  weak: number;
  strong: number;
  extreme: number;
} {
  if (pair === "ETH") {
    return {
      weak: BTC_THRESHOLDS.weak * ETH_MULTIPLIER,
      strong: BTC_THRESHOLDS.strong * ETH_MULTIPLIER,
      extreme: BTC_THRESHOLDS.extreme * ETH_MULTIPLIER,
    };
  }
  return BTC_THRESHOLDS;
}

/**
 * Mutlak CVD değerinden büyüklük kategorisi.
 */
export function classifyMagnitude(
  pair: Pair,
  absCvdUsd: number,
): CvdMagnitude {
  const t = getThresholds(pair);
  if (absCvdUsd < t.weak) return "neutral";
  if (absCvdUsd < t.strong) return "weak";
  if (absCvdUsd < t.extreme) return "strong";
  return "extreme";
}

/**
 * CVD değerinden yön.
 * Neutral magnitude (< weak threshold) → "neutral"
 */
export function classifyDirection(
  pair: Pair,
  cvdUsd: number,
): CvdDirection {
  const mag = classifyMagnitude(pair, Math.abs(cvdUsd));
  if (mag === "neutral") return "neutral";
  return cvdUsd > 0 ? "bullish" : "bearish";
}

// ════════════════ PENCERE CVD HESABI ════════════════

/**
 * Belirli timestamp eşiği sonrasında gelen trade'ler için CVD hesapla.
 *
 * Saf fonksiyon — input trade'ler, çıktı CvdWindow.
 */
export function computeCvdWindow(
  pair: Pair,
  trades: readonly Trade[],
  windowMs: number,
  now: number = Date.now(),
): CvdWindow {
  const afterTs = now - windowMs;
  let buyUsd = 0;
  let sellUsd = 0;
  let tradeCount = 0;

  for (const t of trades) {
    if (t.timestamp < afterTs) continue;
    tradeCount += 1;
    if (t.side === "buy") {
      buyUsd += t.notionalUsd;
    } else {
      sellUsd += t.notionalUsd;
    }
  }

  const cvdUsd = buyUsd - sellUsd;

  return {
    windowMs,
    cvdUsd,
    tradeCount,
    direction: classifyDirection(pair, cvdUsd),
    magnitude: classifyMagnitude(pair, Math.abs(cvdUsd)),
    buyUsd,
    sellUsd,
  };
}

/**
 * Multi-frame CVD: 1dk + 5dk + 15dk + confluence.
 */
export function computeCvdMultiFrame(
  pair: Pair,
  trades: readonly Trade[],
  now: number = Date.now(),
): CvdMultiFrame {
  const w1m = computeCvdWindow(pair, trades, 60_000, now);
  const w5m = computeCvdWindow(pair, trades, 5 * 60_000, now);
  const w15m = computeCvdWindow(pair, trades, 15 * 60_000, now);

  // Confluence: kaç pencere aynı (non-neutral) yönde?
  const dirs = [w1m.direction, w5m.direction, w15m.direction];
  const bullishCount = dirs.filter((d) => d === "bullish").length;
  const bearishCount = dirs.filter((d) => d === "bearish").length;

  let confluence = 0;
  let confluenceDirection: CvdDirection = "neutral";

  if (bullishCount > bearishCount) {
    confluence = bullishCount;
    confluenceDirection = "bullish";
  } else if (bearishCount > bullishCount) {
    confluence = bearishCount;
    confluenceDirection = "bearish";
  }
  // Eşitlik durumunda neutral kalır

  return {
    pair,
    w1m,
    w5m,
    w15m,
    confluence,
    confluenceDirection,
  };
}

// ════════════════ HUMAN READABLE ════════════════

/**
 * CVD'yi insan-okunaklı string'e çevir (örn: "+$1.8M", "-$340K").
 */
export function formatCvd(cvdUsd: number): string {
  const abs = Math.abs(cvdUsd);
  const sign = cvdUsd >= 0 ? "+" : "-";
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}
