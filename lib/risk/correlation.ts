/**
 * CORRELATION LIMITER — Eşzamanlı aynı yönlü işlem hard limiti.
 *
 * Problem: BTC LONG + ETH LONG + SOL LONG açıksa risk üç katı, korelasyon ~%80+
 * Çözüm: Aynı anda açık pozisyonlardaki toplam LONG veya SHORT sayısı
 *         `maxSameDirection` eşiğini aşarsa yeni işlem hard bloke edilir.
 *
 * Varsayılan: maxSameDirection = 1 (tek yönde tek açık pozisyon)
 *
 * Bu modül score/blocks.ts'deki checkCorrelationCluster'ın (soft, BTC↔ETH)
 * hard enforcement ve çok-pair karşılığıdır.
 *
 * Saf fonksiyon — I/O yok.
 */

import type { Pair } from "@/lib/constants/pairs";

export interface OpenPositionSummary {
  pair: Pair;
  direction: "LONG" | "SHORT";
  status: "open" | "pending";
}

export interface CorrelationLimitConfig {
  /**
   * Aynı anda aynı yönde açılabilecek maksimum pozisyon sayısı.
   * Default 1: tek yönde tek açık pozisyon.
   */
  maxSameDirection: number;
}

export const DEFAULT_CORRELATION_CONFIG: CorrelationLimitConfig = {
  maxSameDirection: 1,
};

export interface CorrelationCheckResult {
  blocked: boolean;
  reason: string | null;
  /** Şu an açık olan aynı yöndeki pozisyonlar */
  conflictingPositions: OpenPositionSummary[];
}

/**
 * Yeni işlem açılmadan önce korelasyon limitini kontrol eder.
 *
 * @param pair      Açılmak istenen pair
 * @param direction Açılmak istenen yön
 * @param openPositions Şu an açık/bekleyen pozisyonlar (pair + direction)
 * @param config    Limit konfigürasyonu
 */
export function checkCorrelationLimit(
  pair: Pair,
  direction: "LONG" | "SHORT",
  openPositions: readonly OpenPositionSummary[],
  config: CorrelationLimitConfig = DEFAULT_CORRELATION_CONFIG,
): CorrelationCheckResult {
  if (!openPositions || openPositions.length === 0) {
    return { blocked: false, reason: null, conflictingPositions: [] };
  }

  // Mevcut açık/bekleyen pozisyonlardan aynı yöndekiler (farklı pair dahil)
  const sameDirection = openPositions.filter(
    (p) =>
      (p.status === "open" || p.status === "pending") &&
      p.direction === direction &&
      p.pair !== pair, // kendisi hariç
  );

  if (sameDirection.length >= config.maxSameDirection) {
    const pairList = sameDirection.map((p) => p.pair).join(", ");
    return {
      blocked: true,
      reason: `Korelasyon limiti: ${sameDirection.length} ${direction} pozisyon zaten açık (${pairList}). Max: ${config.maxSameDirection}`,
      conflictingPositions: sameDirection,
    };
  }

  return { blocked: false, reason: null, conflictingPositions: sameDirection };
}
