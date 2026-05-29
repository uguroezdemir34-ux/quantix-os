/**
 * FLOW INTELLIGENCE PIPELINE — Score Engine'e bypass adaptörü.
 *
 * Bu modül v3.0'ın "iki aşamalı süzgeç" mimarisinin yapışkanı.
 *
 * Mevcut Score Engine değiştirilmedi (1846 testi koruyoruz). Yan adaptör:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  MEVCUT: ScoreEngine.computeScore()         │
 *   │           ↓                                  │
 *   │  base ScoreResult { score: 75 }              │
 *   │           ↓                                  │
 *   │  YENİ: FlowIntelligence.enrich()             │
 *   │     - CVD multi-frame                        │
 *   │     - Delta Divergence (VETO?)               │
 *   │     - VPIN multiplier                        │
 *   │     - SMC events                             │
 *   │     - Liquidation magnet                     │
 *   │           ↓                                  │
 *   │  EnrichedVerdict { adjusted: 83, ... }       │
 *   │           ↓                                  │
 *   │  VerdictBuilder (mevcut) → UI                │
 *   └─────────────────────────────────────────────┘
 *
 * Mantık:
 *   1. ScoreEngine zaten karar verdi (75 = LONG potansiyel)
 *   2. Flow Intelligence onaylar/iptal eder/güçlendirir
 *   3. Final score = clamp(0-100), confidence = base × multiplier
 *
 * Flow filter KAPATILABİLİR — kullanıcı isterse mevcut akışa döner.
 */

import type { Pair } from "@/lib/constants/pairs";
import type { Trade } from "./types";
import type { Candle } from "./smc";
import type { VpinState } from "./vpin";
import {
  computeFlowVerdict,
  emptyFlowVerdict,
  type FlowVerdict,
  type SignalDirection,
} from "./flowVerdict";
import { analyzeSmc, smcScoreAdjustment, type SmcAnalysis } from "./smc";
import {
  buildLiquidationMap,
  liquidationScoreAdjustment,
  type LiquidationMap,
} from "./liquidationMap";

/**
 * Flow Intelligence'ın Score Engine'e ekleyeceği tam paket.
 */
export interface FlowIntelligenceResult {
  pair: Pair;
  signalDirection: SignalDirection;

  /** CVD + Divergence + VPIN verdict'i */
  flowVerdict: FlowVerdict;
  /** SMC pattern analizi */
  smc: SmcAnalysis;
  /** Liquidation magnet haritası */
  liqMap: LiquidationMap;

  /** Toplam skor adjustment (clamp -15 ila +15) */
  totalAdjustment: number;
  /** Confidence multiplier (0.4-1.6) */
  confidenceMultiplier: number;
  /** VETO durumu */
  vetoed: boolean;
  /** VETO sebebi */
  vetoReason: string | null;
  /** Detaylı sebep listesi */
  reasons: string[];
  /** UI için tek satır özet */
  humanSummary: string;
}

/**
 * Pipeline'ı çalıştır — saf hesap.
 *
 * Tüm modüller opsiyonel (parametre verilmemişse skip edilir).
 *
 * @param vpinState VPIN engine state'i (opsiyonel)
 * @param currentPrice Current spot price (liq map için)
 */
export function enrichWithFlowIntelligence(
  pair: Pair,
  signalDirection: SignalDirection,
  trades: readonly Trade[],
  candles: readonly Candle[],
  currentPrice: number,
  vpinState?: VpinState,
  now: number = Date.now(),
): FlowIntelligenceResult {
  // Yetersiz veri → bypass (etki yok)
  if (trades.length === 0 && candles.length === 0) {
    return {
      pair,
      signalDirection,
      flowVerdict: emptyFlowVerdict(pair, signalDirection),
      smc: {
        pair,
        orderBlocks: [],
        liquidityGrabs: [],
        fairValueGaps: [],
        recentEvents: [],
      },
      liqMap: {
        pair,
        currentPrice,
        levels: [],
        nearestLongLiq: null,
        nearestShortLiq: null,
        magnetZones: [],
      },
      totalAdjustment: 0,
      confidenceMultiplier: 1.0,
      vetoed: false,
      vetoReason: null,
      reasons: [],
      humanSummary: "Yetersiz flow verisi",
    };
  }

  // 1. Flow verdict (CVD + Divergence + VPIN)
  const flowVerdict = computeFlowVerdict(
    pair,
    trades,
    signalDirection,
    now,
    vpinState,
  );

  // VETO ÖNCELİKLİ — diğer adjustment'ları engelle
  if (flowVerdict.vetoed) {
    return {
      pair,
      signalDirection,
      flowVerdict,
      smc: analyzeSmc(candles, pair),
      liqMap: buildLiquidationMap(pair, candles, currentPrice),
      totalAdjustment: -10, // sembolik, vetoed=true önemli
      confidenceMultiplier: 0.5,
      vetoed: true,
      vetoReason: flowVerdict.vetoReason,
      reasons: [flowVerdict.vetoReason ?? "VETO"],
      humanSummary: flowVerdict.humanSummary,
    };
  }

  // 2. SMC analizi
  const smc = analyzeSmc(candles, pair);
  const smcResult = smcScoreAdjustment(smc, signalDirection);

  // 3. Liquidation map
  const liqMap = buildLiquidationMap(pair, candles, currentPrice);
  const liqResult = liquidationScoreAdjustment(liqMap, signalDirection);

  // 4. Toplam adjustment (clamp ±15)
  const rawTotal =
    flowVerdict.scoreAdjustment + smcResult.adjustment + liqResult.adjustment;
  const totalAdjustment = Math.max(-15, Math.min(15, rawTotal));

  // 5. Confidence multiplier = flow × (1 + smc/20 + liq/30) — additive boost
  // Bu, "her ek sinyal güveni biraz artırır" mantığı
  // SMC etkisi: ±10/20 = ±0.5; LiqMap etkisi: ±3/30 = ±0.1
  const smcMult = 1.0 + smcResult.adjustment / 20;
  const liqMult = 1.0 + liqResult.adjustment / 30;
  const confidenceMultiplier = Math.max(
    0.4,
    Math.min(1.6, flowVerdict.confidenceMultiplier * smcMult * liqMult),
  );

  // 6. Sebepleri birleştir
  const reasons: string[] = [];
  if (flowVerdict.scoreAdjustment !== 0) {
    reasons.push(`Flow ${flowVerdict.scoreAdjustment > 0 ? "+" : ""}${flowVerdict.scoreAdjustment}: ${flowVerdict.humanSummary}`);
  }
  for (const r of smcResult.reasons) {
    reasons.push(`SMC ${r}`);
  }
  if (liqResult.adjustment !== 0) {
    reasons.push(`Liq ${liqResult.adjustment > 0 ? "+" : ""}${liqResult.adjustment}: ${liqResult.reason}`);
  }

  // 7. Human summary
  let humanSummary = flowVerdict.humanSummary;
  if (smc.recentEvents.length > 0) {
    const recent = smc.recentEvents[0];
    humanSummary += ` · ${recent.label}`;
  }

  return {
    pair,
    signalDirection,
    flowVerdict,
    smc,
    liqMap,
    totalAdjustment,
    confidenceMultiplier,
    vetoed: false,
    vetoReason: null,
    reasons,
    humanSummary,
  };
}

/**
 * Helper: Score Engine'in çıktısına flow adjustment'ı uygula.
 *
 * Mevcut ScoreResult'a dokunmaz, yeni adjusted alanlar ekler.
 */
export interface AdjustedScoreResult {
  /** Mevcut score (Score Engine'den) */
  baseScore: number;
  /** Flow adjustment (-15 ila +15) */
  flowAdjustment: number;
  /** Adjusted score (clamp 0-100) */
  adjustedScore: number;
  /** Adjusted confidence */
  adjustedConfidence: number;
  /** VETO durumu */
  vetoed: boolean;
  /** VETO sebebi */
  vetoReason: string | null;
}

export function applyFlowAdjustment(
  baseScore: number,
  baseConfidence: number,
  flow: FlowIntelligenceResult,
): AdjustedScoreResult {
  if (flow.vetoed) {
    return {
      baseScore,
      flowAdjustment: 0,
      adjustedScore: 0, // VETO → skor sıfır (sinyal iptal)
      adjustedConfidence: 0,
      vetoed: true,
      vetoReason: flow.vetoReason,
    };
  }

  const adjustedScore = Math.max(
    0,
    Math.min(100, baseScore + flow.totalAdjustment),
  );
  const adjustedConfidence = Math.max(
    0,
    Math.min(1, baseConfidence * flow.confidenceMultiplier),
  );

  return {
    baseScore,
    flowAdjustment: flow.totalAdjustment,
    adjustedScore,
    adjustedConfidence,
    vetoed: false,
    vetoReason: null,
  };
}
