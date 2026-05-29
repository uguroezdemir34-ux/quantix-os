/**
 * SCORE ORCHESTRATOR — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 7166-8014 (computeScoreForPair).
 *
 * Bu modül paket #5 serisinin kapatma taşı. Aşağıdaki modülleri
 * tek pipeline'da birleştirir:
 *   #5a — S/R modifier (detectSRLevels)
 *   #5c — bucket stats
 *   #5d-i — direction, scorers, sweep bonus, regime bonus
 *   #5d-ii — hard + soft blocks
 *
 * MİMARİ KARARI: Panel'in `ST` global state'i yerine her şey input olarak
 * geliyor. Bu, test edilebilirliği ve Faz 2 UI entegrasyonunu kolaylaştırıyor.
 * Real-time veri akışı: store → orchestrator → UI/Telegram.
 */

import { inferDirection, type Direction, type DirectionInput } from "./direction";
import {
  scoreTrend,
  scoreAdx,
  scoreRsi,
  scoreVolume,
  scoreBb,
  scoreVwap,
  scoreFunding,
  scoreMacro,
  scoreSweepBonus,
  scoreRegimeBonus,
  type SweepInput,
  type VwapInput,
  type Regime,
} from "./scorers";

// Diğer modüllerin (forward test vs.) kullanabilmesi için re-export
export type { Direction } from "./direction";
export type { SignalType } from "./pullback";
import {
  checkVolBreakoutOverride,
  checkOverextended,
  checkNeutralDirection,
  checkCounterTrend,
  checkAdxWeakOrTired,
  checkRsiExtreme,
  checkBbOutOfBand,
  checkVwapExtreme,
  checkVolumeLow,
  checkFundingExtreme,
  checkTimeQuality,
  checkEventSkip,
  checkBtcCooldown,
  checkBtcSelfCooldown,
  checkDailyTrendOpposite,
  checkFundingCrowded,
  checkLockReleaseRamp,
  checkCorrelationCluster,
  checkAtrRegime,
} from "./blocks";
import { getBucketStats, type Trade } from "@/lib/bucket/stats";
import {
  detectPullbackSetup,
  type SignalType,
  PULLBACK_CONSTANTS,
} from "./pullback";

// ═══════════════════════════════════════════════════════════════════
// INPUT/OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ScoreInput {
  pair: string;

  // Fiyatlar
  px: number;
  px4h: number;
  px15: number;

  // EMA'lar
  ema21_15m: number | null;
  ema50_1h: number | null;
  ema200_1h: number | null;
  ema50_4h: number | null;
  ema200_4h: number | null;
  ema50_1d: number | null;

  // İndikatörler
  rsi: number | null;
  adx: number | null;
  bbPct: number | null;
  vwap: VwapInput | null;
  volRatio: number | null;
  fundingRate: number | null;
  atrPercentile: number | null;

  // Pullback engine için ek veri (paket #5e)
  /** 4H ADX değeri */
  adx4h: number | null;
  /** 1H EMA21 */
  ema21_1h: number | null;
  /** 1H mum kapanışları (en yenisi sonda) — en az 8 mum */
  closes1h: readonly number[];
  /** 1H hacim verisi (en yenisi sonda) — en az 11 mum */
  volumes1h: readonly number[];

  // S/R modifier (paket #5a output)
  srModifier: number;

  // Sweep input (paket #5b output - "type: bullish_sweep/bearish_sweep")
  sweep15m: SweepInput;

  // Macro
  fg: number;

  // 4H mum hareket bilgisi (volBreakout için)
  last4hMovePct: number | null;

  // Time quality (panel timeQuality() çıktısı)
  timeQuality: { quality: number; reason: string };

  // State (orchestrator'a dışarıdan geliyor — store'dan)
  eventSkipUntil: number | null;
  btcCooldownUntil: number | null;
  btcCooldownReason: string;
  btcSelfCooldownUntil: number | null;
  lockReleasedAt: number | null;
  openPositions: ReadonlyArray<{ pair: string; direction: Direction }>;

  // Drawdown protocol (paket #4 output)
  drawdownProtocol: {
    tier: "normal" | "caution" | "restricted" | "locked";
    minScore: number;
    label: string;
    reason: string;
  };

  // Bucket stats için trade history
  trades: readonly Trade[];

  // Şu an (test edilebilirlik)
  now: number;
}

export type Verdict = "go" | "wait" | "no";

export interface ScoreSubScores {
  trend: number;
  adx: number;
  rsi: number;
  vol: number;
  bb: number;
  vwap: number;
  funding: number;
  macro: number;
}

export interface ScoreReasons {
  trend: string;
  adx: string;
  rsi: string;
  vol: string;
  bb: string;
  vwap: string;
  funding: string;
  macro: string;
  sweep?: string;
  regime?: string;
  regimeRelax?: string;
  volBreakout?: string;
  atrRegime?: string;
  drawdownGate?: string;
  adaptiveCut?: string;
  softBlock?: string;
  lockRamp?: string;
  pullback?: string;
  pullbackThreshold?: string;
}

export interface ScoreResult {
  pair: string;
  score: number;
  baseScore: number;
  total: number;
  verdict: Verdict;
  direction: Direction;
  dirConfidence: number;
  counterTrend: boolean;
  sub: ScoreSubScores;
  reasons: ScoreReasons;
  blocks: string[];
  softBlocks: string[];
  sweepBonus: number;
  regimeBonus: number;
  regime: Regime;
  goThreshold: number;
  bucket: ReturnType<typeof getBucketStats>;
  // Modifiers
  srModifier: number;
  atrRegimeAdj: number;
  volBreakoutActive: boolean;
  // Pullback engine (paket #5e)
  signalType: SignalType;
  pullbackActive: boolean;
  pullbackThreshold: number;
  /** Etkin eşik: pullback aktifse pullbackThreshold, değilse goThreshold */
  effectiveThreshold: number;
  // Overextended detail (UI için)
  overextFlags: number;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Bir pair için score, verdict ve tüm metadata'yı hesapla.
 *
 * Pipeline:
 *   1. Direction inference (3 TF EMA)
 *   2. 8 kategori puanı + counterTrend tespit
 *   3. baseScore = Σ kategoriler
 *   4. SR modifier ekle (paket #5a)
 *   5. Sweep bonus (baseScore≥75 gate)
 *   6. Regime bonus (baseScore≥75 gate)
 *   7. total = clamp(0, 100, base + sweep + regime + srMod)
 *   8. Hard blocks (13 kural)
 *   9. Soft blocks (6 kural)
 *  10. Bucket lookup + goThreshold hesabı
 *  11. Drawdown protocol min score gate
 *  12. ATR regime adj
 *  13. Verdict: hard block → 'no', soft block + skor → 'wait', skor yeterli → 'go'
 */
export function computeScore(input: ScoreInput): ScoreResult {
  const {
    pair,
    px,
    px4h,
    px15,
    ema21_15m,
    ema50_1h,
    ema200_1h,
    ema50_4h,
    ema200_4h,
    ema50_1d,
    rsi,
    adx,
    bbPct,
    vwap,
    volRatio,
    fundingRate,
    atrPercentile,
    adx4h,
    ema21_1h,
    closes1h,
    volumes1h,
    srModifier,
    sweep15m,
    fg,
    last4hMovePct,
    timeQuality,
    eventSkipUntil,
    btcCooldownUntil,
    btcCooldownReason,
    btcSelfCooldownUntil,
    lockReleasedAt,
    openPositions,
    drawdownProtocol,
    trades,
    now,
  } = input;

  // ───── 1. Direction ─────
  const dirInput: DirectionInput = {
    px15,
    px1h: px,
    px4h,
    ema21_15m,
    ema50_1h,
    ema200_1h,
    ema50_4h,
  };
  const { direction, confidence: dirConfidence } = inferDirection(dirInput);

  // ───── 2. Skor kategorileri ─────
  const trendResult = scoreTrend(direction, dirConfidence, px4h, ema200_4h);
  const counterTrend = trendResult.counterTrend;
  const adxResult = scoreAdx(adx);
  const rsiResult = scoreRsi(rsi, direction);
  const volResult = scoreVolume(volRatio);
  const bbResult = scoreBb(bbPct, direction);
  const vwapResult = scoreVwap(vwap, px, direction);
  const fundingResult = scoreFunding(fundingRate, direction);
  const macroResult = scoreMacro(fg, direction);

  const sub: ScoreSubScores = {
    trend: trendResult.score,
    adx: adxResult.score,
    rsi: rsiResult.score,
    vol: volResult.score,
    bb: bbResult.score,
    vwap: vwapResult.score,
    funding: fundingResult.score,
    macro: macroResult.score,
  };

  const baseScore =
    sub.trend + sub.adx + sub.rsi + sub.vol + sub.bb + sub.vwap + sub.funding + sub.macro;

  // ───── 3. Sweep bonus ─────
  const sweepRes = scoreSweepBonus(sweep15m, direction, baseScore);

  // ───── 4. Regime bonus ─────
  const regimeRes = scoreRegimeBonus({
    adx,
    dirConfidence,
    counterTrend,
    bbPct,
    baseScore,
    direction,
  });

  // ───── 5. Total ─────
  const total = Math.min(
    100,
    Math.max(0, baseScore + sweepRes.bonus + regimeRes.bonus + srModifier),
  );
  const score = Math.round(total);

  // ───── 6. Reasons obj baseline ─────
  const reasons: ScoreReasons = {
    trend: trendResult.reason,
    adx: adxResult.reason,
    rsi: rsiResult.reason,
    vol: volResult.reason,
    bb: bbResult.reason,
    vwap: vwapResult.reason,
    funding: fundingResult.reason,
    macro: macroResult.reason,
  };
  if (sweepRes.reason) reasons.sweep = sweepRes.reason;
  if (regimeRes.reason) reasons.regime = regimeRes.reason;
  if (regimeRes.regime === "trending_strong" && (direction === "LONG" || direction === "SHORT")) {
    reasons.regimeRelax = `🔥 Trending strong rejim · RSI eşiği ${direction === "LONG" ? "75→80" : "25→20"} gevşedi`;
  }

  // ───── 7. VolBreakout override (BB hard iptal için) ─────
  const trend4hUp = ema50_4h !== null && px4h > ema50_4h;
  const trend4hDown = ema50_4h !== null && px4h < ema50_4h;
  const volBreakout = checkVolBreakoutOverride({
    direction,
    volRatio,
    adx,
    baseScore,
    last4hMovePct,
    trend4hUp,
    trend4hDown,
  });
  if (volBreakout.reason) reasons.volBreakout = volBreakout.reason;

  // ───── 8. Hard blocks ─────
  const blocks: string[] = [];
  const overext = checkOverextended({ direction, rsi, bbPct, vwap, px });
  if (overext) blocks.push(overext);
  const neutral = checkNeutralDirection(direction);
  if (neutral) blocks.push(neutral);
  const ct = checkCounterTrend(counterTrend);
  if (ct) blocks.push(ct);
  const adxBlock = checkAdxWeakOrTired(adx);
  if (adxBlock) blocks.push(adxBlock);
  const rsiBlock = checkRsiExtreme({ rsi, direction, regime: regimeRes.regime });
  if (rsiBlock) blocks.push(rsiBlock);
  const bbBlocks = checkBbOutOfBand(bbPct, volBreakout.active);
  for (const b of bbBlocks) blocks.push(b);
  const vwapBlock = checkVwapExtreme(vwap, px);
  if (vwapBlock) blocks.push(vwapBlock);
  const volBlock = checkVolumeLow(volRatio);
  if (volBlock) blocks.push(volBlock);
  const fundingBlock = checkFundingExtreme(fundingRate);
  if (fundingBlock) blocks.push(fundingBlock);
  const tqBlock = checkTimeQuality(timeQuality);
  if (tqBlock) blocks.push(tqBlock);
  const eventBlock = checkEventSkip({ eventSkipUntil, now });
  if (eventBlock) blocks.push(eventBlock);
  const btcCdBlock = checkBtcCooldown({
    pair,
    btcCooldownUntil,
    btcCooldownReason,
    now,
  });
  if (btcCdBlock) blocks.push(btcCdBlock);
  const btcSelfCd = checkBtcSelfCooldown({
    pair,
    btcSelfCooldownUntil,
    btcCooldownReason,
    now,
  });
  if (btcSelfCd) blocks.push(btcSelfCd);

  // ───── 9. Soft blocks ─────
  const softBlocks: string[] = [];
  const dailyTrend = checkDailyTrendOpposite({ direction, px, ema50_1d });
  if (dailyTrend) softBlocks.push(dailyTrend);
  const fundingCrowded = checkFundingCrowded(fundingRate, direction);
  if (fundingCrowded) softBlocks.push(fundingCrowded);
  const lockRamp = checkLockReleaseRamp({ lockReleasedAt, now });
  if (lockRamp.message) softBlocks.push(lockRamp.message);
  const corrCluster = checkCorrelationCluster({
    pair,
    direction,
    openPositions,
  });
  if (corrCluster) softBlocks.push(corrCluster);
  const atrReg = checkAtrRegime({ percentile: atrPercentile });
  if (atrReg.softBlock) softBlocks.push(atrReg.softBlock);
  if (atrReg.reason) reasons.atrRegime = atrReg.reason;

  // ───── 10. Bucket + goThreshold ─────
  // Panel davranışı (satır 7903): bucket baseScore üzerinden hesaplanır
  const bucket = getBucketStats(baseScore, trades);
  let goThreshold = bucket.isCut ? Math.min(96, bucket.max + 1) : 80;
  if (lockRamp.active) {
    goThreshold = Math.min(96, goThreshold + 5);
  }

  // ATR regime adj (panel satır 7937)
  goThreshold = Math.max(60, Math.min(96, goThreshold + atrReg.adj));

  // Drawdown protocol min score gate (panel satır 7947-7952)
  if (drawdownProtocol.tier !== "normal" && drawdownProtocol.minScore > goThreshold) {
    const oldThreshold = goThreshold;
    goThreshold = Math.min(96, drawdownProtocol.minScore);
    reasons.drawdownGate = `${drawdownProtocol.label} ${drawdownProtocol.reason} → eşik ${oldThreshold}→${goThreshold}`;
  }

  // ───── 10b. Pullback engine (paket #5e) ─────
  const pullback = detectPullbackSetup({
    direction,
    px4h,
    ema50_4h,
    ema50_1h,
    ema21_1h,
    closes1h,
    volumes1h,
    adx4h,
    rsi1h: rsi,
    sweep15m,
    fg,
    baseScore,
  });
  if (pullback.reason) reasons.pullback = pullback.reason;

  // pullbackThreshold hesabı (panel satır 7958-7966)
  // Formül: max(65, min(96, 72 + atrAdj + (drawdown delta) + (lockRamp ? 5 : 0)))
  let pullbackThreshold = goThreshold;
  if (pullback.active) {
    const drawdownDelta =
      drawdownProtocol.tier !== "normal" ? drawdownProtocol.minScore - 80 : 0;
    pullbackThreshold = Math.max(
      65,
      Math.min(
        96,
        PULLBACK_CONSTANTS.PULLBACK_THRESHOLD +
          atrReg.adj +
          drawdownDelta +
          (lockRamp.active ? 5 : 0),
      ),
    );
    reasons.pullbackThreshold = `🔄 Pullback eşiği ${pullbackThreshold} (klasik ${goThreshold})`;
  }

  // Etkin eşik
  const effectiveThreshold = pullback.active ? pullbackThreshold : goThreshold;

  // ───── 11. Verdict ─────
  let verdict: Verdict;
  if (blocks.length > 0) {
    verdict = "no";
  } else if (softBlocks.length > 0 && total >= effectiveThreshold) {
    verdict = "wait";
  } else if (total >= effectiveThreshold) {
    verdict = "go";
  } else if (total >= 65) {
    verdict = "wait";
  } else {
    verdict = "no";
  }

  // ───── 12. Adaptive cut explanation (panel satır 7985) ─────
  if (
    bucket.isCut &&
    baseScore >= 80 &&
    baseScore < goThreshold &&
    bucket.wr !== null
  ) {
    reasons.adaptiveCut = `Skor ${baseScore} ama ${bucket.min}-${bucket.max} bucket WR ${bucket.wr.toFixed(0)}% (n=${bucket.n}) zayıf → ${goThreshold}+ bekle`;
  }

  // Soft block summary
  if (softBlocks.length > 0 && total >= effectiveThreshold) {
    reasons.softBlock = softBlocks.join(" · ");
  }

  // Lock ramp mesajı (panel satır 7997-8000) — düşük skorda da göster
  if (lockRamp.active && lockReleasedAt !== null) {
    const hoursSince = ((now - lockReleasedAt) / 3600000).toFixed(1);
    reasons.lockRamp = `🔓 Kilit kalkalı ${hoursSince}sa — skor ${goThreshold}+ gerek (normal: 80, ramp: +5)`;
  }

  // Overextended detail (UI gösterim için)
  let overextFlags = 0;
  if (overext) {
    const flagsCount = (overext.match(/,/g) || []).length + 1;
    overextFlags = flagsCount;
  }

  return {
    pair,
    score,
    baseScore,
    total,
    verdict,
    direction,
    dirConfidence,
    counterTrend,
    sub,
    reasons,
    blocks,
    softBlocks,
    sweepBonus: sweepRes.bonus,
    regimeBonus: regimeRes.bonus,
    regime: regimeRes.regime,
    goThreshold,
    bucket,
    srModifier,
    atrRegimeAdj: atrReg.adj,
    volBreakoutActive: volBreakout.active,
    signalType: pullback.signalType,
    pullbackActive: pullback.active,
    pullbackThreshold,
    effectiveThreshold,
    overextFlags,
  };
}
