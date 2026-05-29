/**
 * RISK CALCULATOR — Bakiye + bucket + drawdown çarpanlı risk hesabı.
 *
 * Kaynak: panel_v55_51.html satır 4847-4884.
 *
 * Hesap zinciri:
 *   1. Baz risk: bakiye'ye göre 0.5% / 1% / 1.5%
 *   2. Bucket adjustment: cut 0.5× / boost 1.25× / nötr 1.0×
 *   3. Drawdown adjustment: protocol'den (normal 1.0× ... locked 0×)
 *   4. Final risk = balance × baseRiskPct × bucketAdj × ddAdj
 */

import type { RiskResult } from "./types";
import { SIZER_CONFIG } from "./types";

export interface RiskCalcInput {
  balance: number;
  bucket: {
    isCut: boolean;
    isBoost: boolean;
    n: number;
    hasData: boolean;
  };
  drawdownProtocol: {
    tier: "normal" | "caution" | "restricted" | "locked";
    multiplier: number;
  };
}

export function computeRiskUsd(input: RiskCalcInput): RiskResult {
  const { balance, bucket, drawdownProtocol } = input;

  // 1. Baz risk: bakiye'ye göre tier
  let baseRiskPct = SIZER_CONFIG.BASE_RISK_TIERS[2].risk; // default %1.5
  for (const tier of SIZER_CONFIG.BASE_RISK_TIERS) {
    if (balance < tier.maxBalance) {
      baseRiskPct = tier.risk;
      break;
    }
  }

  // 2. Bucket adjustment
  let bucketAdj = 1.0;
  if (bucket.isCut) {
    bucketAdj = SIZER_CONFIG.BUCKET_CUT_ADJ;
  } else if (bucket.isBoost) {
    bucketAdj = SIZER_CONFIG.BUCKET_BOOST_ADJ;
  }

  // 3. Drawdown adjustment
  // multiplier > 0 → normal çarpan
  // tier=locked / multiplier=0 → ddAdj=0 (tam kilit, risk sıfırlanır)
  let ddAdj = 1.0;
  if (drawdownProtocol.tier !== "normal") {
    ddAdj = drawdownProtocol.multiplier;
  }

  // 4. Final risk
  const riskPct = baseRiskPct * bucketAdj * ddAdj;
  const riskUsd = balance * riskPct;

  return {
    riskPct,
    riskUsd,
    bucketAdj,
    ddAdj,
    baseRiskPct,
  };
}

/**
 * Bakiyeye göre kaldıraç önerisi.
 */
export function suggestLeverage(balance: number): number {
  for (const tier of SIZER_CONFIG.LEVERAGE_TIERS) {
    if (balance < tier.maxBalance) return tier.leverage;
  }
  return SIZER_CONFIG.LEVERAGE_TIERS[SIZER_CONFIG.LEVERAGE_TIERS.length - 1]
    .leverage;
}
