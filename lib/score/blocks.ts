/**
 * HARD + SOFT BLOCK KURALLARI — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 7678-7893.
 *
 * Bu modül "verdict" kararının veto/uyarı katmanını uygular:
 *   - Hard block → verdict 'no' (trade yok)
 *   - Soft block → verdict 'wait' (skor yeterli ama bekle)
 *
 * Her fonksiyon SAF: input → string|null. null = bu kural tetiklenmedi.
 * Block string'leri kullanıcıya gösterilir (Telegram + UI).
 *
 * KRİTİK: Eşikler değiştirilmemeli. Bunlar panelinin oturmuş kalibrasyonu:
 *   - RSI: 25/75 (regime_strong'da 20/80)
 *   - BB: %3 / %97 (volBreakout override ile iptal)
 *   - VWAP: 2σ
 *   - Volume: 0.7×
 *   - Funding: 0.06%
 *   - ATR percentile: 95
 *   - Lock ramp: 24 saat
 *
 * Panel #5d-iii orchestrator bu fonksiyonları sıralı çağırıp blocks[]
 * ve softBlocks[] arraylerini doldurur.
 */

import type { Direction } from "./direction";
import type { VwapInput, Regime } from "./scorers";

// ═══════════════════════════════════════════════════════════════════
// VOLUME BREAKOUT OVERRIDE (BB hard bloğu iptal helper'ı)
// ═══════════════════════════════════════════════════════════════════

export interface VolBreakoutInput {
  direction: Direction;
  volRatio: number | null;
  adx: number | null;
  baseScore: number;
  /** Son kapanmış 4H mum kapanış değişimi (%) */
  last4hMovePct: number | null;
  /** 4H trend yönü ile uyumlu mu (px4 vs ema50_4h) */
  trend4hUp: boolean;
  trend4hDown: boolean;
}

/**
 * Extreme hacimli kırılım (volRatio ≥ 3.0) BB band dışı hard'ı iptal eder.
 * Tüm 5 şart birden gerekli.
 * Panel referansı: satır 7735-7751.
 */
export function checkVolBreakoutOverride(
  input: VolBreakoutInput,
): { active: boolean; reason: string | null } {
  const { direction, volRatio, adx, baseScore, last4hMovePct, trend4hUp, trend4hDown } = input;
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";

  if (!(isLong || isShort)) return { active: false, reason: null };
  if (volRatio === null || volRatio < 3.0) return { active: false, reason: null };
  if (adx === null || adx < 25) return { active: false, reason: null };
  if (baseScore < 75) return { active: false, reason: null };
  if (last4hMovePct === null) return { active: false, reason: null };

  if (isLong && last4hMovePct >= 2.0 && trend4hUp) {
    return {
      active: true,
      reason: `📊 Hacim patlaması (${volRatio.toFixed(2)}x) + 4H +${last4hMovePct.toFixed(2)}% · BB hard iptal`,
    };
  }
  if (isShort && last4hMovePct <= -2.0 && trend4hDown) {
    return {
      active: true,
      reason: `📊 Hacim patlaması (${volRatio.toFixed(2)}x) + 4H ${last4hMovePct.toFixed(2)}% · BB hard iptal`,
    };
  }
  return { active: false, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// HARD BLOCKS — verdict 'no'
// ═══════════════════════════════════════════════════════════════════

export interface OverextendedInput {
  direction: Direction;
  rsi: number | null;
  bbPct: number | null;
  vwap: VwapInput | null;
  px: number;
}

/**
 * KOMPOZIT AŞIRI UZANMIŞ — 2 veya daha fazla flag bir araya gelirse hard block.
 * Panel referansı: satır 7683-7702.
 *
 * LONG flagleri: RSI>70, BB>0.80, VWAP +distSigma>1.3
 * SHORT flagleri: RSI<30, BB<0.20, VWAP -distSigma>1.3
 */
export function checkOverextended(input: OverextendedInput): string | null {
  const { direction, rsi, bbPct, vwap, px } = input;
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";

  if (!(isLong || isShort)) return null;

  const flags: string[] = [];

  if (isShort) {
    if (rsi !== null && rsi < 30) flags.push(`RSI ${rsi.toFixed(0)}`);
    if (bbPct !== null && bbPct < 0.2) flags.push(`BB ${(bbPct * 100).toFixed(0)}%`);
    if (vwap !== null && vwap.stddev > 0) {
      const distSigma = Math.abs(px - vwap.vwap) / vwap.stddev;
      if (px < vwap.vwap && distSigma > 1.3) {
        flags.push(`VWAP -${distSigma.toFixed(1)}σ`);
      }
    }
  } else {
    // LONG
    if (rsi !== null && rsi > 70) flags.push(`RSI ${rsi.toFixed(0)}`);
    if (bbPct !== null && bbPct > 0.8) flags.push(`BB ${(bbPct * 100).toFixed(0)}%`);
    if (vwap !== null && vwap.stddev > 0) {
      const distSigma = Math.abs(px - vwap.vwap) / vwap.stddev;
      if (px > vwap.vwap && distSigma > 1.3) {
        flags.push(`VWAP +${distSigma.toFixed(1)}σ`);
      }
    }
  }

  if (flags.length >= 2) {
    return `⚠️ Aşırı uzanmış: ${flags.join(", ")} — geri çekilme bekle`;
  }
  return null;
}

export function checkNeutralDirection(direction: Direction): string | null {
  return direction === "NEUTRAL" ? "Yön belirsiz" : null;
}

export function checkCounterTrend(counterTrend: boolean): string | null {
  return counterTrend ? "🚫 Counter-trend (4H ana trende karşı)" : null;
}

export function checkAdxWeakOrTired(adx: number | null): string | null {
  if (adx === null) return null;
  if (adx < 20) return `ADX zayıf (${adx.toFixed(0)})`;
  if (adx > 50) return `ADX yorgun (${adx.toFixed(0)})`;
  return null;
}

export interface RsiExtremeInput {
  rsi: number | null;
  direction: Direction;
  regime: Regime;
}

/**
 * RSI hard block (regime relax ile asimetrik gevşeme).
 * trending_strong + yön uyumlu → eşikler 75→80 / 25→20 gevşer.
 * Panel referansı: satır 7715-7724.
 */
export function checkRsiExtreme(input: RsiExtremeInput): string | null {
  const { rsi, direction, regime } = input;
  if (rsi === null) return null;
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";
  const regimeRelax = regime === "trending_strong" && (isLong || isShort);

  const upperHard = regimeRelax && isLong ? 80 : 75;
  const lowerHard = regimeRelax && isShort ? 20 : 25;

  if (rsi > upperHard) {
    return `RSI aşırı alım (${rsi.toFixed(0)}${regimeRelax && isLong ? ", regime relax ile" : ""})`;
  }
  if (rsi < lowerHard) {
    return `RSI aşırı satım (${rsi.toFixed(0)}${regimeRelax && isShort ? ", regime relax ile" : ""})`;
  }
  return null;
}

/**
 * BB hard block — volBreakoutOverride aktifse iptal.
 * Panel referansı: satır 7755-7758.
 */
export function checkBbOutOfBand(
  bbPct: number | null,
  volBreakoutActive: boolean,
): string[] {
  const out: string[] = [];
  if (volBreakoutActive) return out;
  if (bbPct === null) return out;
  if (bbPct > 0.97) out.push("BB üst dışı");
  if (bbPct < 0.03) out.push("BB alt dışı");
  return out;
}

export function checkVwapExtreme(
  vwap: VwapInput | null,
  px: number,
): string | null {
  if (vwap === null || vwap.stddev <= 0) return null;
  const distSigma = Math.abs(px - vwap.vwap) / vwap.stddev;
  if (distSigma > 2.0) {
    return `VWAP ${px > vwap.vwap ? "+" : "-"}${distSigma.toFixed(1)}σ (aşırı uzak)`;
  }
  return null;
}

export function checkVolumeLow(volRatio: number | null): string | null {
  if (volRatio === null) return null;
  return volRatio < 0.7
    ? `Hacim çok düşük (${volRatio.toFixed(2)}x) - teyitsiz`
    : null;
}

export function checkFundingExtreme(fundingRate: number | null): string | null {
  if (fundingRate === null) return null;
  const fr = fundingRate * 100;
  return Math.abs(fr) > 0.06 ? `Funding aşırı (${fr.toFixed(3)}%)` : null;
}

export interface TimeQualityInput {
  /** Panel timeQuality() çıktısı: { quality: number, reason: string } */
  quality: number;
  reason: string;
}

export function checkTimeQuality(input: TimeQualityInput): string | null {
  return input.quality === 0 ? input.reason : null;
}

export interface EventSkipInput {
  /** ST.eventSkipUntil — null/0 ise aktif değil */
  eventSkipUntil: number | null;
  now: number;
}

export function checkEventSkip(input: EventSkipInput): string | null {
  const { eventSkipUntil, now } = input;
  if (!eventSkipUntil || now >= eventSkipUntil) return null;
  const remainMin = Math.ceil((eventSkipUntil - now) / 60000);
  const remainTxt =
    remainMin >= 60
      ? `${Math.floor(remainMin / 60)}sa ${remainMin % 60}dk`
      : `${remainMin}dk`;
  return `📅 Event skip aktif (${remainTxt} kaldı)`;
}

export interface BtcCooldownInput {
  pair: string;
  /** ST.btcCooldownUntil — alt'lar için */
  btcCooldownUntil: number | null;
  /** ST.btcCooldownReason — opsiyonel */
  btcCooldownReason: string;
  now: number;
}

/**
 * BTC korelasyon cooldown (alt'lar için).
 * Panel referansı: satır 7785-7789.
 */
export function checkBtcCooldown(input: BtcCooldownInput): string | null {
  const { pair, btcCooldownUntil, btcCooldownReason, now } = input;
  if (pair === "BTC") return null;
  if (!btcCooldownUntil || now >= btcCooldownUntil) return null;
  const remainMin = Math.ceil((btcCooldownUntil - now) / 60000);
  const reasonText = btcCooldownReason ? ` (${btcCooldownReason})` : "";
  return `🚨 BTC korelasyon ${remainMin}dk soğuma${reasonText}`;
}

export interface BtcSelfCooldownInput {
  pair: string;
  btcSelfCooldownUntil: number | null;
  btcCooldownReason: string;
  now: number;
}

/**
 * BTC self-cooldown (sadece BTC pair'i için).
 * Panel referansı: satır 7797-7801.
 */
export function checkBtcSelfCooldown(
  input: BtcSelfCooldownInput,
): string | null {
  const { pair, btcSelfCooldownUntil, btcCooldownReason, now } = input;
  if (pair !== "BTC") return null;
  if (!btcSelfCooldownUntil || now >= btcSelfCooldownUntil) return null;
  const remainMin = Math.ceil((btcSelfCooldownUntil - now) / 60000);
  const reasonText = btcCooldownReason ? ` (${btcCooldownReason})` : "";
  return `🚨 BTC kendi spike sonrası ${remainMin}dk soğuma${reasonText}`;
}

// ═══════════════════════════════════════════════════════════════════
// SOFT BLOCKS — verdict 'wait'
// ═══════════════════════════════════════════════════════════════════

export interface DailyTrendInput {
  direction: Direction;
  px: number;
  ema50_1d: number | null;
}

/**
 * Daily EMA50 trend filter.
 * Panel referansı: satır 7810-7818.
 */
export function checkDailyTrendOpposite(input: DailyTrendInput): string | null {
  const { direction, px, ema50_1d } = input;
  if (ema50_1d === null) return null;
  if (direction === "LONG" && px < ema50_1d) {
    return `📅 Daily trend ters: px ${px.toFixed(2)} < EMA50_1D ${ema50_1d.toFixed(2)}`;
  }
  if (direction === "SHORT" && px > ema50_1d) {
    return `📅 Daily trend ters: px ${px.toFixed(2)} > EMA50_1D ${ema50_1d.toFixed(2)}`;
  }
  return null;
}

/**
 * Funding mid-tier kalabalık soft block (0.04%-0.06% aralığı, yön funding ile aynı).
 * Panel referansı: satır 7824-7834.
 */
export function checkFundingCrowded(
  fundingRate: number | null,
  direction: Direction,
): string | null {
  if (fundingRate === null) return null;
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";
  if (!(isLong || isShort)) return null;

  const fr = fundingRate * 100;
  const absFr = Math.abs(fr);
  if (absFr < 0.04 || absFr > 0.06) return null;

  if (isLong && fr > 0) {
    return `💰 Funding +${fr.toFixed(3)}% — LONG kalabalık, üstüne binme`;
  }
  if (isShort && fr < 0) {
    return `💰 Funding ${fr.toFixed(3)}% — SHORT kalabalık, üstüne binme`;
  }
  return null;
}

export interface LockRampInput {
  /** ST.lockReleasedAt — null ise ramp aktif değil */
  lockReleasedAt: number | null;
  now: number;
}

/**
 * Lock release ramp — kilit kalktıktan sonra 24 saat ekstra disiplin.
 * Panel referansı: satır 7861-7866.
 *
 * Bonus: aktifse goThreshold +5 artar (orchestrator'da uygulanır).
 */
export function checkLockReleaseRamp(input: LockRampInput): {
  active: boolean;
  message: string | null;
} {
  const { lockReleasedAt, now } = input;
  if (!lockReleasedAt) return { active: false, message: null };
  const elapsed = now - lockReleasedAt;
  if (elapsed >= 24 * 60 * 60 * 1000) return { active: false, message: null };
  const hoursSince = (elapsed / 3600000).toFixed(1);
  return {
    active: true,
    message: `🔓 Kilit kalkalı ${hoursSince}sa — ilk trade için kalite eşiği yükseldi`,
  };
}

export interface CorrelationClusterInput {
  pair: string;
  direction: Direction;
  /** Açık pozisyonlar — { pair, direction } */
  openPositions: ReadonlyArray<{ pair: string; direction: Direction }>;
}

/**
 * BTC-ETH korelasyon clustered risk.
 * Aynı yönde 2 pozisyon = 1.85× tek pozisyon (korelasyon ~%85).
 * Ters yön → HEDGE, block yok.
 * Panel referansı: satır 7877-7893.
 */
export function checkCorrelationCluster(
  input: CorrelationClusterInput,
): string | null {
  const { pair, direction, openPositions } = input;
  if (direction !== "LONG" && direction !== "SHORT") return null;
  if (!openPositions || openPositions.length === 0) return null;

  let corrPair: string | null = null;
  if (pair === "BTC") corrPair = "ETH";
  else if (pair === "ETH") corrPair = "BTC";
  if (corrPair === null) return null;

  const otherOpen = openPositions.find(
    (p) => p.pair === corrPair && p.direction === direction,
  );
  if (otherOpen) {
    return `🔗 ${corrPair} ${direction} açık — korelasyon ~%85, clustered risk`;
  }
  return null;
}

export interface AtrRegimeInput {
  /** ATR yüzdesi (0-100) */
  percentile: number | null;
}

/**
 * ATR percentile rejim modifier + extreme soft block.
 * Panel referansı: satır 7918-7935.
 *
 * @returns adj (eşik modifier), softBlock (extreme için), reason (her durumda)
 */
export function checkAtrRegime(input: AtrRegimeInput): {
  adj: number;
  softBlock: string | null;
  reason: string | null;
} {
  const { percentile } = input;
  if (percentile === null) return { adj: 0, softBlock: null, reason: null };

  const p = percentile;
  if (p < 20) {
    return {
      adj: -3,
      softBlock: null,
      reason: `🟢 ATR %${p} — compression (sakin) · eşik -3`,
    };
  }
  if (p > 95) {
    return {
      adj: 5,
      softBlock: `⚡ Volatilite extreme (ATR %${p}) — geniş wick riski yüksek`,
      reason: `🔴 ATR %${p} — extreme expansion (kaos) · eşik +5`,
    };
  }
  if (p > 80) {
    return {
      adj: 5,
      softBlock: null,
      reason: `🟠 ATR %${p} — expansion (volatil) · eşik +5`,
    };
  }
  return {
    adj: 0,
    softBlock: null,
    reason: `⚪ ATR %${p} — normal rejim`,
  };
}
