/**
 * DELTA DIVERGENCE DETECTOR — Sierra Chart'ın gizli silahı.
 *
 * Konsept: Fiyat ve CVD ters yönde hareket ediyorsa "divergence" var demektir.
 * Bu, klasik "smart money absorption" sinyalidir:
 *
 *   - Fiyat YUKARI + CVD AŞAĞI:
 *     "Fiyat yükseliyor ama büyük market sell var" → BEARISH DIVERGENCE
 *     Yorum: Whale satıyor, retail alıyor — fiyat kısa sürede dönebilir
 *
 *   - Fiyat AŞAĞI + CVD YUKARI:
 *     "Fiyat düşüyor ama büyük market buy var" → BULLISH DIVERGENCE
 *     Yorum: Whale alıyor, retail satıyor — dip yakın
 *
 * Bu, sahte sinyalleri eleyen GATEKEEPER görevi görür:
 *   - Score Engine LONG diyor + bearish divergence → VETO veya skor düşür
 *   - Score Engine SHORT diyor + bullish divergence → VETO veya skor düşür
 */

import type { Trade } from "./types";
import type { Pair } from "@/lib/constants/pairs";
import { computeCvdWindow } from "./cvd";

export type DivergenceType =
  | "none" // Fiyat ve CVD aynı yönde (uyumlu)
  | "bullish_divergence" // Fiyat aşağı + CVD yukarı
  | "bearish_divergence" // Fiyat yukarı + CVD aşağı
  | "neutral"; // CVD veya fiyat değişimi yetersiz

export interface DivergenceResult {
  type: DivergenceType;
  /** Fiyat değişimi yüzdesi (negatifse düşüş) */
  priceChangePct: number;
  /** CVD değeri (pencere sonu - pencere başı) */
  cvdUsd: number;
  /** Pencere uzunluğu ms */
  windowMs: number;
  /** İnsan okunaklı yorum */
  humanReason: string;
}

/**
 * Fiyat değişimi yüzdesini hesapla — pencere başlangıcı vs sonu.
 *
 * @returns Yüzde (ör. 0.005 = %0.5 yukarı, -0.012 = %1.2 aşağı), veya null
 */
function priceChangeInWindow(
  trades: readonly Trade[],
  windowMs: number,
  now: number,
): number | null {
  const afterTs = now - windowMs;
  // Pencere içinde en eski ve en yeni trade
  let oldestPrice: number | null = null;
  let newestPrice: number | null = null;
  let oldestTs = Infinity;
  let newestTs = 0;

  for (const t of trades) {
    if (t.timestamp < afterTs) continue;
    if (t.timestamp < oldestTs) {
      oldestTs = t.timestamp;
      oldestPrice = t.price;
    }
    if (t.timestamp > newestTs) {
      newestTs = t.timestamp;
      newestPrice = t.price;
    }
  }

  if (oldestPrice === null || newestPrice === null) return null;
  if (oldestPrice === 0) return null;

  return (newestPrice - oldestPrice) / oldestPrice;
}

/**
 * Divergence threshold'ları.
 * Önemli sinyal olması için hem fiyat hem CVD anlamlı olmalı.
 */
const PRICE_CHANGE_MIN = 0.001; // %0.1 — gürültü ötesi
const CVD_MIN_USD_BTC = 100_000;
const CVD_MIN_USD_ETH = 25_000; // BTC * 0.25

function cvdMinUsd(pair: Pair): number {
  return pair === "ETH" ? CVD_MIN_USD_ETH : CVD_MIN_USD_BTC;
}

/**
 * Divergence tespit et.
 *
 * Logic:
 *   1. Fiyat değişimi anlamlı mı (> %0.1)
 *   2. CVD anlamlı mı (> threshold)
 *   3. Yönler ters mi
 *
 * Eğer her ikisi anlamlı ama AYNI yöndeyse → "none" (uyumlu)
 * Eğer her ikisi anlamlı ama TERS yöndeyse → divergence
 * Eğer biri/ikisi anlamsızsa → "neutral"
 */
export function detectDivergence(
  pair: Pair,
  trades: readonly Trade[],
  windowMs: number,
  now: number = Date.now(),
): DivergenceResult {
  const priceChangePct = priceChangeInWindow(trades, windowMs, now);
  const cvdWindow = computeCvdWindow(pair, trades, windowMs, now);

  if (priceChangePct === null) {
    return {
      type: "neutral",
      priceChangePct: 0,
      cvdUsd: cvdWindow.cvdUsd,
      windowMs,
      humanReason: "Yetersiz fiyat verisi",
    };
  }

  const absCvd = Math.abs(cvdWindow.cvdUsd);
  const absPrice = Math.abs(priceChangePct);

  // Anlamlılık kontrolü
  if (absPrice < PRICE_CHANGE_MIN || absCvd < cvdMinUsd(pair)) {
    return {
      type: "neutral",
      priceChangePct,
      cvdUsd: cvdWindow.cvdUsd,
      windowMs,
      humanReason: "Hareket gürültü seviyesinde",
    };
  }

  // İki taraf da anlamlı — yön karşılaştır
  const priceUp = priceChangePct > 0;
  const cvdUp = cvdWindow.cvdUsd > 0;

  if (priceUp === cvdUp) {
    // Uyumlu: fiyat ve CVD aynı yönde
    return {
      type: "none",
      priceChangePct,
      cvdUsd: cvdWindow.cvdUsd,
      windowMs,
      humanReason: priceUp
        ? "Fiyat yukarı, CVD destekliyor (uyumlu)"
        : "Fiyat aşağı, CVD destekliyor (uyumlu)",
    };
  }

  // Ters yön — divergence
  if (priceUp && !cvdUp) {
    // Fiyat yukarı, CVD aşağı → whale satıyor
    return {
      type: "bearish_divergence",
      priceChangePct,
      cvdUsd: cvdWindow.cvdUsd,
      windowMs,
      humanReason:
        "Fiyat yukarı ama büyük market sell — smart money satıyor",
    };
  }

  // Fiyat aşağı, CVD yukarı → whale alıyor
  return {
    type: "bullish_divergence",
    priceChangePct,
    cvdUsd: cvdWindow.cvdUsd,
    windowMs,
    humanReason: "Fiyat aşağı ama büyük market buy — smart money alıyor",
  };
}

/**
 * Çoklu pencere divergence — confluence kontrolü.
 *
 * 5dk ve 15dk pencerelerinde divergence varsa daha güvenilir sinyal.
 */
export interface MultiFrameDivergence {
  pair: Pair;
  /** 5dk pencere */
  d5m: DivergenceResult;
  /** 15dk pencere */
  d15m: DivergenceResult;
  /** Her iki pencerede de aynı divergence var mı? */
  confluence: boolean;
  /** Confluence tipi (varsa) */
  confluenceType: DivergenceType;
}

export function detectMultiFrameDivergence(
  pair: Pair,
  trades: readonly Trade[],
  now: number = Date.now(),
): MultiFrameDivergence {
  const d5m = detectDivergence(pair, trades, 5 * 60_000, now);
  const d15m = detectDivergence(pair, trades, 15 * 60_000, now);

  const sameDiv =
    d5m.type === d15m.type &&
    (d5m.type === "bullish_divergence" || d5m.type === "bearish_divergence");

  return {
    pair,
    d5m,
    d15m,
    confluence: sameDiv,
    confluenceType: sameDiv ? d5m.type : "none",
  };
}
