/**
 * S/R DETECTION ORCHESTRATOR — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 6695-6807.
 *
 * Tüm seviye kaynaklarını toplar:
 *   - 4H pivot high/low (primer, daha güvenilir)
 *   - 1H pivot high/low (sekonder, hızlı)
 *   - Önceki gün/hafta H-L (PDH/PDL/PWH/PWL)
 *   - Yuvarlak sayılar (psikolojik)
 *
 * Sonra:
 *   - Mevcut fiyata göre direnç/destek olarak sınıflandırır
 *   - Dedup (0.3% içinde aynı sayar)
 *   - Asimetrik modifier hesaplar (SADECE CEZA, ödül yok, max -30)
 *   - Sıkışma bölgesi tespit eder (extra -5 ceza)
 *   - Breakout override (volume teyitli kırılım → ceza iptal)
 *
 * KRİTİK NOT: Skor motorunun "soft penalty" kısmı. Tek başına block etmez,
 * skor azaltır. Yön LONG/SHORT/NEUTRAL olarak gelir; NEUTRAL'da modifier=0.
 */

import type { Candle } from "@/types/candle";
import {
  findAllSwingHighs,
  findAllSwingLows,
} from "./swing";
import {
  getPrevPeriodLevels,
  getRoundNumberLevels,
  calculateLevelStrength,
  type LevelType,
} from "./levels";

export type Direction = "LONG" | "SHORT" | "NEUTRAL";

export type SrLevelType =
  | "pivot_4h_high"
  | "pivot_4h_low"
  | "pivot_1h_high"
  | "pivot_1h_low"
  | LevelType; // PDH/PDL/PWH/PWL/ROUND

export interface SrLevelEntry {
  price: number;
  type: SrLevelType;
  strength: number;
  distance_pct: number;
}

export interface SrLevels {
  resistances: SrLevelEntry[];
  supports: SrLevelEntry[];
  nearest_resistance: SrLevelEntry | null;
  nearest_support: SrLevelEntry | null;
}

export interface SrMeta {
  chopZone: boolean;
  breakoutOverride: boolean;
  direction: Direction;
}

export interface SrResult {
  levels: SrLevels;
  modifier: number;
  meta: SrMeta;
}

/**
 * Asimetrik ceza hesabı.
 * Panel `calcPenalty` (satır 6744-6751) ile birebir.
 *
 * Mesafe bazlı (%):
 *   ≤0.5%  → 20 base
 *   ≤1.5%  → 10
 *   ≤2.5%  → 5
 *   >2.5%  → 0
 *
 * Strength çarpanı:
 *   1   → ×0.5
 *   2   → ×1.0
 *   ≥3  → ×1.5
 */
function calcPenalty(distPct: number, strength: number): number {
  let base = 0;
  if (distPct <= 0.5) base = 20;
  else if (distPct <= 1.5) base = 10;
  else if (distPct <= 2.5) base = 5;
  const mult = strength <= 1 ? 0.5 : strength === 2 ? 1.0 : 1.5;
  return Math.round(base * mult);
}

/**
 * Ana orchestrator — tüm S/R seviyelerini toplar ve modifier hesaplar.
 *
 * @param k4h 4H mumlar (önceki gün/hafta hesabı + 4H pivot)
 * @param k1h 1H mumlar (1H pivot + strength testi)
 * @param currentPrice Mevcut fiyat
 * @param direction LONG/SHORT/NEUTRAL
 * @param volRatio Hacim oranı (breakout override için, ≥1.3 gerek)
 */
export function detectSRLevels(
  k4h: readonly Candle[],
  k1h: readonly Candle[],
  currentPrice: number,
  direction: Direction,
  volRatio: number | null | undefined,
): SrResult {
  // Erken çıkış: yetersiz veri
  if (!currentPrice || !k1h || k1h.length < 10) {
    return {
      levels: {
        resistances: [],
        supports: [],
        nearest_resistance: null,
        nearest_support: null,
      },
      modifier: 0,
      meta: { chopZone: false, breakoutOverride: false, direction },
    };
  }

  // Pivot kaynakları
  const pivR4 = findAllSwingHighs(k4h, 60, 3, 5).map((p) => ({
    ...p,
    type: "pivot_4h_high" as const,
  }));
  const pivS4 = findAllSwingLows(k4h, 60, 3, 5).map((p) => ({
    ...p,
    type: "pivot_4h_low" as const,
  }));
  const pivR1 = findAllSwingHighs(k1h, 80, 3, 5).map((p) => ({
    ...p,
    type: "pivot_1h_high" as const,
  }));
  const pivS1 = findAllSwingLows(k1h, 80, 3, 5).map((p) => ({
    ...p,
    type: "pivot_1h_low" as const,
  }));
  const prev = getPrevPeriodLevels(k4h);
  const rounds = getRoundNumberLevels(currentPrice);

  // Hepsini birleştir (panel satır 6708 ile aynı sırada — sıra dedup için önemli)
  const all: Array<{ price: number; type: SrLevelType }> = [
    ...pivR4,
    ...pivS4,
    ...pivR1,
    ...pivS1,
    ...prev,
    ...rounds,
  ];

  const seen = new Set<number>();
  const resistances: SrLevelEntry[] = [];
  const supports: SrLevelEntry[] = [];

  for (const lvl of all) {
    if (!lvl.price || lvl.price <= 0) continue;
    const distPct = ((lvl.price - currentPrice) / currentPrice) * 100;

    // Dedup: 0.3% içinde aynı seviye sayılır
    const key = Math.round(lvl.price / (currentPrice * 0.003));
    if (seen.has(key)) continue;
    seen.add(key);

    const side = distPct > 0 ? "resistance" : "support";
    const strength = calculateLevelStrength(k1h, lvl.price, side);
    const entry: SrLevelEntry = {
      price: lvl.price,
      type: lvl.type,
      strength,
      distance_pct: Math.abs(distPct),
    };
    if (distPct > 0.05) resistances.push(entry);
    else if (distPct < -0.05) supports.push(entry);
  }

  // Mesafeye göre yakın → uzak sırala
  resistances.sort((a, b) => a.distance_pct - b.distance_pct);
  supports.sort((a, b) => a.distance_pct - b.distance_pct);

  const nearestR = resistances[0] || null;
  const nearestS = supports[0] || null;

  // Modifier — asimetrik, direction-aware
  let modifier = 0;
  if (direction === "LONG" && nearestR) {
    modifier = -calcPenalty(nearestR.distance_pct, nearestR.strength);
  } else if (direction === "SHORT" && nearestS) {
    modifier = -calcPenalty(nearestS.distance_pct, nearestS.strength);
  }

  // Sıkışma bölgesi: hem direnç hem destek %2 içinde
  const chopZone = !!(
    nearestR &&
    nearestS &&
    nearestR.distance_pct <= 2.0 &&
    nearestS.distance_pct <= 2.0
  );

  // Breakout override (v55.28 Aşama 3) — volume teyitli kırılım cezayı iptal eder
  let breakoutOverride = false;
  if (k1h && k1h.length >= 3 && volRatio !== null && volRatio !== undefined && volRatio >= 1.3) {
    const lastClosed = k1h[k1h.length - 2]; // son kapalı bar
    const prevClosed = k1h[k1h.length - 3]; // ondan önceki
    if (lastClosed && prevClosed) {
      // Round number HARIÇ — çok zayıf seviye
      const candidateLevels = [...resistances, ...supports].filter(
        (l) => l.type !== "ROUND",
      );
      for (const lvl of candidateLevels) {
        if (
          direction === "LONG" &&
          prevClosed.c < lvl.price &&
          lastClosed.c > lvl.price
        ) {
          breakoutOverride = true;
          break;
        }
        if (
          direction === "SHORT" &&
          prevClosed.c > lvl.price &&
          lastClosed.c < lvl.price
        ) {
          breakoutOverride = true;
          break;
        }
      }
    }
  }

  if (breakoutOverride) {
    modifier = 0; // doğrulanmış kırılım: ceza iptal
  } else if (chopZone && (direction === "LONG" || direction === "SHORT")) {
    modifier = Math.max(-30, modifier - 5);
  }

  return {
    levels: {
      resistances: resistances.slice(0, 5),
      supports: supports.slice(0, 5),
      nearest_resistance: nearestR,
      nearest_support: nearestS,
    },
    modifier,
    meta: { chopZone, breakoutOverride, direction },
  };
}
