/**
 * POSITION SIZER — Birleştirilmiş pozisyon büyüklüğü hesabı.
 *
 * Kaynak: panel_v55_51.html satır 4794-4940 (renderPositionSizer).
 *
 * Bu modül stop + tp + risk modüllerini birleştirir ve final
 * position sizing sonucunu döndürür.
 */

import type { PositionSizerInput, PositionSizerResult } from "./types";
import { SIZER_CONFIG } from "./types";
import { computeStructuralStop } from "./stop";
import { computeAdaptiveTPs } from "./take-profit";
import { computeRiskUsd, suggestLeverage } from "./risk";

export function computePositionSize(
  input: PositionSizerInput,
): PositionSizerResult {
  const { pair, direction, px, atr, adx1h, swingLow, swingHigh, balance } =
    input;

  // 1. Stop hesabı
  const stop = computeStructuralStop(direction, px, atr, swingLow, swingHigh);

  // 2. TP hesabı
  const tp = computeAdaptiveTPs(direction, px, atr, adx1h);

  // 3. Risk hesabı
  const risk = computeRiskUsd({
    balance: balance.total,
    bucket: input.bucket,
    drawdownProtocol: input.drawdownProtocol,
  });

  // 4. Position size (coin cinsinden) = risk / stop distance
  const qty = stop.stopDistance > 0 ? risk.riskUsd / stop.stopDistance : 0;
  const notional = qty * px;
  const leverage = suggestLeverage(balance.total);
  const margin = leverage > 0 ? notional / leverage : 0;

  // 5. R:R hesabı
  const rr1 = stop.stopDistance > 0 ? (tp.tp1Mult * atr) / stop.stopDistance : 0;
  const rr2 = stop.stopDistance > 0 ? (tp.tp2Mult * atr) / stop.stopDistance : 0;

  // 6. Yüzdesel mesafeler
  const stopPct = px > 0 ? (stop.stopDistance / px) * 100 : 0;
  const tp1Pct = px > 0 ? ((tp.tp1Mult * atr) / px) * 100 : 0;
  const tp2Pct = px > 0 ? ((tp.tp2Mult * atr) / px) * 100 : 0;

  // 7. Feasibility
  const canAfford = margin <= balance.free + 0.01;
  const minSizeOK = notional >= SIZER_CONFIG.MIN_NOTIONAL_USD;

  // 8. Uyarı seviyesi
  let warnLevel: PositionSizerResult["warnLevel"] = "ok";
  let warnKind: PositionSizerResult["warnKind"] = "ok";
  let warnMessage = "";

  if (input.drawdownProtocol.tier === "locked") {
    warnLevel = "blocked";
    warnKind = "locked";
    warnMessage = "🔒 Hesap kilitli — drawdown protokolü";
  } else if (!canAfford) {
    warnLevel = "blocked";
    warnKind = "insufficient_margin";
    warnMessage = `⚠️ Yetersiz margin (gerekli $${margin.toFixed(2)}, serbest $${balance.free.toFixed(2)})`;
  } else if (!minSizeOK) {
    warnLevel = "warning";
    warnKind = "below_min_size";
    warnMessage = `⚠️ Pozisyon OKX min altında ($${notional.toFixed(2)} < $${SIZER_CONFIG.MIN_NOTIONAL_USD}). Stop daralt veya bakiye artır.`;
  }

  return {
    pair,
    direction,
    px,
    stop,
    tp,
    risk,
    qty,
    notional,
    leverage,
    margin,
    rr1,
    rr2,
    stopPct,
    tp1Pct,
    tp2Pct,
    canAfford,
    minSizeOK,
    warnLevel,
    warnKind,
    warnMessage,
  };
}
