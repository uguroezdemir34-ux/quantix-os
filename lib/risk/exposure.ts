/**
 * EXPOSURE CONTROL — Kümülatif Risk Yoğunlaşma Filtresi.
 *
 * Problem: BTC LONG + ETH LONG + SOL LONG açıksa sistem tek yönlü
 * korelasyon riskine (piyasa çöküşünde tümü zarar) maruz kalır.
 * Mevcut correlation.ts direction count'u sınırlar; bu modül
 * margin yoğunlaşmasını (USD bazında) sınırlar.
 *
 * İki katman:
 *   1. TotalExposureCap — tüm açık pozisyonların kümülatif marjini
 *      net equity'nin dynamicCapPct'ini aşamaz. (Varsayılan %25)
 *
 *   2. DirectionalExposureCap — tek yönde (LONG veya SHORT) kümülatif
 *      marjin, net equity'nin directionalCapPct'ini aşamaz. (Varsayılan %20)
 *
 *   3. ScaleDown — yeni pozisyon bu limitleri aşacaksa, limiti aşmayan
 *      en büyük pozisyon büyüklüğüne otomatik kısılır (0 → blocked).
 *
 * Saf fonksiyonlar — I/O yok, Date.now() yok.
 *
 * Preflight entegrasyonu: runPreflightChecks() içinde check 5b olarak
 * çalışır (mevcut correlation check'ten SONRA).
 */

import type { Pair } from "@/lib/constants/pairs";

// ─── Tipler ──────────────────────────────────────────────────

/**
 * Tek bir açık/bekleyen pozisyon — margin dahil genişletilmiş özet.
 * correlation.ts'teki OpenPositionSummary'nin üst kümesi.
 */
export interface ExposurePosition {
  pair: Pair;
  direction: "LONG" | "SHORT";
  status: "open" | "pending";
  /** Pozisyon marjini (USDT) — notional / leverage */
  marginUsd: number;
}

export interface ExposureConfig {
  /**
   * Tüm pozisyonların kümülatif margin toplamının net equity'ye oranı.
   * 0.25 = %25 (varsayılan). Aşılırsa yeni pozisyon kısılır/bloke edilir.
   */
  totalCapPct: number;
  /**
   * Tek yön (LONG veya SHORT) kümülatif margin toplamının net equity oranı.
   * 0.20 = %20 (varsayılan).
   */
  directionalCapPct: number;
  /**
   * Minimum marjin eşiği — ScaleDown sonrası pozisyon bu değerin altındaysa
   * tamamen bloke edilir (küçük lotlarla piyasada durmak anlamsız).
   * 5.0 = 5 USDT (varsayılan).
   */
  minMarginUsd: number;
}

export const DEFAULT_EXPOSURE_CONFIG: ExposureConfig = {
  totalCapPct: 0.25,
  directionalCapPct: 0.20,
  minMarginUsd: 5.0,
};

export type ExposureVerdict =
  | "allowed"       // Kısıtlama yok, tam boyut açılabilir
  | "scaled_down"   // Boyut kısıldı ama hâlâ açılabilir
  | "blocked";      // Kısma sonrası min eşik altında → tamamen engellendi

export interface ExposureCheckResult {
  verdict: ExposureVerdict;
  /**
   * Yeni pozisyon için izin verilen maksimum margin (USDT).
   * verdict="allowed"  → requestedMarginUsd
   * verdict="scaled_down" → 0 < allowedMarginUsd < requestedMarginUsd
   * verdict="blocked"  → 0
   */
  allowedMarginUsd: number;
  /**
   * Talep edilen miktara kıyasla ölçekleme oranı.
   * 1.0 = tam boyut, 0.5 = yarı boyut, 0.0 = sıfır (bloke)
   */
  scaleFactor: number;
  /** İnsan-okunabilir neden */
  reason: string;
  /** Mevcut kümülatif pozisyon (talep öncesi) */
  diagnostics: {
    currentTotalMarginUsd: number;
    currentDirectionalMarginUsd: number;
    totalCapLimitUsd: number;
    directionalCapLimitUsd: number;
    equityUsd: number;
  };
}

// ─── Yardımcı hesaplar ────────────────────────────────────────

/**
 * Tüm açık/bekleyen pozisyonların toplam margin.
 */
export function computeTotalMargin(
  positions: readonly ExposurePosition[],
): number {
  let total = 0;
  for (const p of positions) {
    if (p.status === "open" || p.status === "pending") {
      total += Math.max(0, p.marginUsd);
    }
  }
  return total;
}

/**
 * Belirli yöndeki toplam margin.
 */
export function computeDirectionalMargin(
  positions: readonly ExposurePosition[],
  direction: "LONG" | "SHORT",
): number {
  let total = 0;
  for (const p of positions) {
    if (
      (p.status === "open" || p.status === "pending") &&
      p.direction === direction
    ) {
      total += Math.max(0, p.marginUsd);
    }
  }
  return total;
}

// ─── Ana kontrol fonksiyonu ───────────────────────────────────

/**
 * Yeni pozisyon açılmadan önce exposure limitini kontrol et.
 *
 * @param requestedMarginUsd  Yeni pozisyon için talep edilen margin (USDT)
 * @param direction           Yeni pozisyon yönü
 * @param equityUsd           Anlık net kasa büyüklüğü (balance + unrealized)
 * @param openPositions       Mevcut açık/bekleyen pozisyonlar
 * @param config              Limit konfigürasyonu (opsiyonel)
 */
export function checkExposure(
  requestedMarginUsd: number,
  direction: "LONG" | "SHORT",
  equityUsd: number,
  openPositions: readonly ExposurePosition[],
  config: ExposureConfig = DEFAULT_EXPOSURE_CONFIG,
): ExposureCheckResult {
  const currentTotalMarginUsd = computeTotalMargin(openPositions);
  const currentDirectionalMarginUsd = computeDirectionalMargin(openPositions, direction);

  const totalCapLimitUsd = equityUsd * config.totalCapPct;
  const directionalCapLimitUsd = equityUsd * config.directionalCapPct;

  const diagnostics = {
    currentTotalMarginUsd,
    currentDirectionalMarginUsd,
    totalCapLimitUsd,
    directionalCapLimitUsd,
    equityUsd,
  };

  // Mevcut durum zaten limit üstünde (başka kod yolundan)
  // → yeni pozisyon için hiç yer yok
  const totalRoomUsd = Math.max(0, totalCapLimitUsd - currentTotalMarginUsd);
  const directionalRoomUsd = Math.max(0, directionalCapLimitUsd - currentDirectionalMarginUsd);

  // İzin verilen margin: her iki limitten de küçük olanına göre
  const rawAllowedUsd = Math.min(requestedMarginUsd, totalRoomUsd, directionalRoomUsd);

  // Negatif/sıfır margin talebi → direkt bloke
  if (requestedMarginUsd <= 0) {
    return {
      verdict: "blocked",
      allowedMarginUsd: 0,
      scaleFactor: 0,
      reason: "Geçersiz talep: margin ≤ 0",
      diagnostics,
    };
  }

  // Equity sıfır veya negatif → hiçbir pozisyon açılamaz
  if (equityUsd <= 0) {
    return {
      verdict: "blocked",
      allowedMarginUsd: 0,
      scaleFactor: 0,
      reason: "Net kasa (equity) sıfır veya negatif — pozisyon açılamaz",
      diagnostics,
    };
  }

  // Limit aşılmış → bloke
  if (rawAllowedUsd <= 0) {
    const which =
      totalRoomUsd <= 0 ? "toplam exposure cap" : "yönsel exposure cap";
    return {
      verdict: "blocked",
      allowedMarginUsd: 0,
      scaleFactor: 0,
      reason:
        `${which} dolu: mevcut ${direction} marjin=$${currentDirectionalMarginUsd.toFixed(2)}, ` +
        `toplam marjin=$${currentTotalMarginUsd.toFixed(2)}, ` +
        `equity=$${equityUsd.toFixed(2)}`,
      diagnostics,
    };
  }

  // Tam boyut sığıyor → allowed
  if (rawAllowedUsd >= requestedMarginUsd - 0.001) {
    return {
      verdict: "allowed",
      allowedMarginUsd: requestedMarginUsd,
      scaleFactor: 1.0,
      reason: "Exposure limiti dahilinde",
      diagnostics,
    };
  }

  // Kısmi sığıyor → scale down
  const scaleFactor = rawAllowedUsd / requestedMarginUsd;

  if (rawAllowedUsd < config.minMarginUsd) {
    // Kısma sonucu min eşiğin altında → bloke
    const which =
      directionalRoomUsd < totalRoomUsd ? "yönsel" : "toplam";
    return {
      verdict: "blocked",
      allowedMarginUsd: 0,
      scaleFactor: 0,
      reason:
        `ScaleDown sonrası marjin ($${rawAllowedUsd.toFixed(2)}) ` +
        `minimum eşiğin ($${config.minMarginUsd}) altında. ` +
        `${which} cap sınırı aşıldı.`,
      diagnostics,
    };
  }

  const which =
    directionalRoomUsd < totalRoomUsd ? "yönsel exposure cap" : "toplam exposure cap";
  return {
    verdict: "scaled_down",
    allowedMarginUsd: rawAllowedUsd,
    scaleFactor: parseFloat(scaleFactor.toFixed(6)),
    reason:
      `${which}: pozisyon %${(scaleFactor * 100).toFixed(1)}'e kısıldı ` +
      `($${requestedMarginUsd.toFixed(2)} → $${rawAllowedUsd.toFixed(2)})`,
    diagnostics,
  };
}

// ─── Qty / Margin dönüşüm yardımcıları ───────────────────────

/**
 * ScaleDown kararını qty'ye uygula.
 *
 * margin = (qty × price) / leverage
 * allowedQty = allowedMarginUsd × leverage / price
 *
 * @returns allowedQty (iki ondalıkta yuvarlanmış)
 */
export function applyScaleFactorToQty(
  originalQty: number,
  scaleFactor: number,
): number {
  if (scaleFactor <= 0) return 0;
  if (scaleFactor >= 1) return originalQty;
  return parseFloat((originalQty * scaleFactor).toFixed(8));
}

/**
 * Margin → Qty dönüşümü.
 * margin = (qty × price) / leverage → qty = margin × leverage / price
 */
export function marginToQty(
  marginUsd: number,
  price: number,
  leverage: number,
): number {
  if (price <= 0 || leverage <= 0) return 0;
  return marginUsd * leverage / price;
}

/**
 * Qty → Margin dönüşümü.
 * margin = (qty × price) / leverage
 */
export function qtyToMargin(
  qty: number,
  price: number,
  leverage: number,
): number {
  if (leverage <= 0) return 0;
  return (qty * price) / leverage;
}

// ─── Toplu özet ──────────────────────────────────────────────

export interface ExposureSummary {
  totalMarginUsd: number;
  longMarginUsd: number;
  shortMarginUsd: number;
  /** Kaç açık pozisyon var */
  positionCount: number;
  /** Toplam cap kullanım oranı (0–1+) */
  totalCapUtilization: number;
  /** LONG cap kullanım oranı */
  longCapUtilization: number;
  /** SHORT cap kullanım oranı */
  shortCapUtilization: number;
}

/**
 * Mevcut tüm açık pozisyonların exposure özetini üret.
 * Dashboard / UI için.
 */
export function computeExposureSummary(
  positions: readonly ExposurePosition[],
  equityUsd: number,
  config: ExposureConfig = DEFAULT_EXPOSURE_CONFIG,
): ExposureSummary {
  const totalMarginUsd = computeTotalMargin(positions);
  const longMarginUsd = computeDirectionalMargin(positions, "LONG");
  const shortMarginUsd = computeDirectionalMargin(positions, "SHORT");
  const positionCount = positions.filter(
    (p) => p.status === "open" || p.status === "pending",
  ).length;

  const totalCapLimitUsd = equityUsd * config.totalCapPct;
  const directionalCapLimitUsd = equityUsd * config.directionalCapPct;

  return {
    totalMarginUsd,
    longMarginUsd,
    shortMarginUsd,
    positionCount,
    totalCapUtilization:
      totalCapLimitUsd > 0 ? totalMarginUsd / totalCapLimitUsd : 0,
    longCapUtilization:
      directionalCapLimitUsd > 0 ? longMarginUsd / directionalCapLimitUsd : 0,
    shortCapUtilization:
      directionalCapLimitUsd > 0 ? shortMarginUsd / directionalCapLimitUsd : 0,
  };
}
