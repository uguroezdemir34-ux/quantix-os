/**
 * MACRO — Saf etiket ve faz fonksiyonları.
 * Kaynak: panel_v55_51.html satır 8411-8473 (renderMarketView içinde).
 *
 * Bunlar TAMAMEN SAF — input → output, side-effect yok, network yok.
 * UI'da renderMarketView içine gömülüydü; v2'de ayrıştırıldı.
 */

import { MACRO_CONSTANTS } from "./types";
import type {
  FgInfo,
  FgLabel,
  FgClass,
  DominanceInfo,
  DominancePhase,
  MarketSummary,
  MarketSummaryClass,
} from "./types";

/**
 * F&G değerini etikete ve CSS sınıfına çevir.
 *
 * Eşikler panel 8411-8416 ile birebir:
 *   <25:  AŞIRI KORKU    (fear)
 *   <45:  KORKU          (caution)
 *   <55:  NÖTR           (neutral)
 *   <75:  AÇGÖZLÜ        (greed)
 *   ≥75:  AŞIRI AÇGÖZLÜ  (extreme-greed)
 */
export function getFgInfo(value: number): FgInfo {
  // 0-100 aralığına clamp
  const v = Math.max(0, Math.min(100, Math.round(value)));

  let label: FgLabel;
  let cssClass: FgClass;

  if (v < MACRO_CONSTANTS.FG_THRESHOLD_FEAR) {
    label = "AŞIRI KORKU";
    cssClass = "fear";
  } else if (v < MACRO_CONSTANTS.FG_THRESHOLD_CAUTION) {
    label = "KORKU";
    cssClass = "caution";
  } else if (v < MACRO_CONSTANTS.FG_THRESHOLD_NEUTRAL) {
    label = "NÖTR";
    cssClass = "neutral";
  } else if (v < MACRO_CONSTANTS.FG_THRESHOLD_GREED) {
    label = "AÇGÖZLÜ";
    cssClass = "greed";
  } else {
    label = "AŞIRI AÇGÖZLÜ";
    cssClass = "extreme-greed";
  }

  return { value: v, label, cssClass };
}

/**
 * BTC.D + USDT.D'den piyasa fazı.
 * Kaynak: panel 8428-8443.
 *
 * Mantık (panel'in yorumuyla):
 *   Yüksek USDT.D    → risk-off (para stable'a kaçıyor)
 *   Yüksek BTC.D     → BTC trend dönemi
 *   Düşük her ikisi  → altcoin sezonu sinyali
 */
export function getDominancePhase(
  btcD: number,
  usdtD: number,
): DominanceInfo {
  if (btcD <= 0 || usdtD <= 0) {
    return {
      btcD,
      usdtD,
      phase: "no_data",
      label: "Veri bekleniyor...",
    };
  }

  let phase: DominancePhase;
  let label: string;

  if (usdtD >= MACRO_CONSTANTS.USDT_HIGH) {
    phase = "risk_off_usdt";
    label = "Risk-Off · USDT'ye kaçış";
  } else if (
    btcD >= MACRO_CONSTANTS.BTC_DOMINANT_MIN &&
    usdtD < MACRO_CONSTANTS.USDT_HEALTHY_MAX
  ) {
    phase = "btc_trend";
    label = "BTC ağırlıklı trend";
  } else if (
    btcD < MACRO_CONSTANTS.BTC_DOMINANT_MAX &&
    usdtD < MACRO_CONSTANTS.USDT_HEALTHY_MAX
  ) {
    phase = "altcoin_season";
    label = "Altcoin sezonu sinyali";
  } else {
    phase = "mixed";
    label = "Karma piyasa";
  }

  return { btcD, usdtD, phase, label };
}

/**
 * F&G + USDT.D'den piyasa genel özeti (sentez).
 * Kaynak: panel 8447-8473.
 *
 * 5 farklı durum:
 *   F&G ≥ 75 + USDT.D < 5      → Risk-On Aşırı (zirve riski)
 *   F&G ≤ 25 veya USDT.D ≥ 5.8 → Risk-Off (korku/USDT kaçışı)
 *   F&G 55-75 + USDT.D < 5.5    → Risk-On Sağlıklı
 *   F&G 30-55                   → Nötr piyasa
 *   diğer                       → Kararsız
 */
export function getMarketSummary(
  fg: number,
  usdtD: number,
): MarketSummary {
  let cls: MarketSummaryClass;
  let icon: string;
  let text: string;

  if (fg >= MACRO_CONSTANTS.FG_THRESHOLD_GREED && usdtD < MACRO_CONSTANTS.USDT_HEALTHY_MAX) {
    cls = "risk_on_caution";
    icon = "⚠️";
    text = "Risk-On · Aşırı iyimserlik (zirve riski)";
  } else if (
    fg <= MACRO_CONSTANTS.FG_THRESHOLD_FEAR ||
    usdtD >= MACRO_CONSTANTS.USDT_EXTREME
  ) {
    cls = "risk_off";
    icon = "🔻";
    text = "Risk-Off · Korku/USDT'ye kaçış";
  } else if (
    fg >= MACRO_CONSTANTS.FG_THRESHOLD_NEUTRAL &&
    fg < MACRO_CONSTANTS.FG_THRESHOLD_GREED &&
    usdtD < MACRO_CONSTANTS.USDT_HEALTHY_RISK_ON
  ) {
    cls = "risk_on_healthy";
    icon = "🟢";
    text = "Risk-On · Sağlıklı iştah";
  } else if (fg >= 30 && fg < MACRO_CONSTANTS.FG_THRESHOLD_NEUTRAL) {
    cls = "neutral";
    icon = "⚖️";
    text = "Nötr piyasa · Temkinli";
  } else {
    cls = "undecided";
    icon = "🟡";
    text = "Piyasa kararsız · Bekleme önerilir";
  }

  return { cls, icon, text };
}
