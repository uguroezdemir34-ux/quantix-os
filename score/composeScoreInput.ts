/**
 * COMPOSE SCORE INPUT — Mum verileri ve macro state'ten ScoreInput oluştur.
 *
 * Bu modül UI/store ile skor pipeline arasındaki KÖPRÜ:
 *   - Veri akışı: WS + REST + macro store → composeScoreInput → computeScore
 *   - Sorumluluk: tüm indikatörleri hesapla, eksik veride null döndür
 *
 * Test stratejisi: gerçek mum dizisi → tüm indikatör hesaplamaları başarılıysa
 * tam ScoreInput, eksik veri varsa null.
 */

import { rsi } from "@/lib/indicators/rsi";
import { ema } from "@/lib/indicators/ema";
import { bb } from "@/lib/indicators/bb";
import { adx } from "@/lib/indicators/adx";
import { vwap } from "@/lib/indicators/vwap";
import { volumeRatio } from "@/lib/indicators/volume-ratio";
import { atrPercentile } from "@/lib/indicators/atr-percentile";
import { toIndicatorCandle } from "@/lib/okx/candles";
import type { Candle as OkxCandle } from "@/lib/okx/candles";
import type { ScoreInput } from "@/lib/score/orchestrator";
import type { Candle as IndCandle } from "@/types/candle";

/** UI tarafından sağlanan veri */
export interface ComposeInput {
  pair: string;
  /** Son fiyat (canlı, WS'den) */
  livePrice: number | null;
  /** 4H mumlar (en az 200) */
  candles4h: readonly OkxCandle[];
  /** 1H mumlar (en az 200) */
  candles1h: readonly OkxCandle[];
  /** 15m mumlar (en az 100) */
  candles15m: readonly OkxCandle[];
  /** Macro: F&G değeri */
  fg: number;
  /** State: tüm risk store değerleri */
  eventSkipUntil: number | null;
  btcCooldownUntil: number | null;
  btcCooldownReason: string;
  btcSelfCooldownUntil: number | null;
  lockReleasedAt: number | null;
  openPositions: ScoreInput["openPositions"];
  drawdownProtocol: ScoreInput["drawdownProtocol"];
  trades: ScoreInput["trades"];
  /** S/R modifier (paket #5a output) - şimdilik 0, sonraki paketlerde compute */
  srModifier: number;
  /** Sweep (paket #5b) - şimdilik no sweep */
  sweep15m: ScoreInput["sweep15m"];
  /** Time quality - şimdilik full quality */
  timeQuality: ScoreInput["timeQuality"];
  /** Şu an (epoch ms) */
  now: number;
}

/**
 * Eksik veri varsa null döner — caller skor hesabını atlamalı.
 *
 * Minimum gereksinim:
 *   - candles4h ≥ 200 (4h EMA200 için)
 *   - candles1h ≥ 200 (1h EMA200 için)
 *   - candles15m ≥ 20 (15m EMA21 için)
 *   - livePrice null değil
 */
export function composeScoreInput(input: ComposeInput): ScoreInput | null {
  const {
    pair,
    livePrice,
    candles4h,
    candles1h,
    candles15m,
    fg,
    eventSkipUntil,
    btcCooldownUntil,
    btcCooldownReason,
    btcSelfCooldownUntil,
    lockReleasedAt,
    openPositions,
    drawdownProtocol,
    trades,
    srModifier,
    sweep15m,
    timeQuality,
    now,
  } = input;

  // Önkoşullar
  if (livePrice === null || livePrice <= 0) return null;
  if (candles4h.length < 200) return null;
  if (candles1h.length < 200) return null;
  if (candles15m.length < 20) return null;

  // İndikatör formatına çevir (her timeframe için)
  const c4h: IndCandle[] = candles4h.map(toIndicatorCandle);
  const c1h: IndCandle[] = candles1h.map(toIndicatorCandle);
  const c15m: IndCandle[] = candles15m.map(toIndicatorCandle);
  const closes4h = c4h.map((c) => c.c);
  const closes1h = c1h.map((c) => c.c);
  const closes15m = c15m.map((c) => c.c);

  // ───── EMA'lar ─────
  const ema21_15m = ema(closes15m, { period: 21 });
  const ema50_1h = ema(closes1h, { period: 50 });
  const ema200_1h = ema(closes1h, { period: 200 });
  const ema21_1h = ema(closes1h, { period: 21 });
  const ema50_4h = ema(closes4h, { period: 50 });
  const ema200_4h = ema(closes4h, { period: 200 });
  // 1d EMA50: 4h candle × 6 → 1d (approx); panel direkt 4h kullanıyor olabilir
  // Şimdilik 4h EMA200 kullanalım — ileri pakette 1d candles eklenebilir
  const ema50_1d = ema200_4h; // approximation

  // ───── İndikatörler (1h ana timeframe) ─────
  const rsiVal = rsi(closes1h);
  const adx1h = adx(c1h);
  const adx4h = adx(c4h);
  const bbVal = bb(closes1h);
  const vwapVal = vwap(c1h, new Date(now));
  const volRatio = volumeRatio(c1h);
  const atrPctRes = atrPercentile(c1h);

  // BB% hesaplama (panel uses bbPct: (close - lower) / (upper - lower))
  let bbPct: number | null = null;
  if (bbVal && bbVal.upper > bbVal.lower) {
    bbPct = (livePrice - bbVal.lower) / (bbVal.upper - bbVal.lower);
  }

  // ───── Son 4h hareket (volBreakout için) ─────
  let last4hMovePct: number | null = null;
  if (c4h.length >= 2) {
    const last = c4h[c4h.length - 1];
    last4hMovePct = ((last.c - last.o) / last.o) * 100;
  }

  // px4h = son 4h kapanış
  const px4h = c4h[c4h.length - 1].c;
  // px15 = son 15m kapanış
  const px15 = c15m[c15m.length - 1].c;

  // ───── ScoreInput ─────
  return {
    pair,
    px: livePrice,
    px4h,
    px15,
    ema21_15m,
    ema50_1h,
    ema200_1h,
    ema50_4h,
    ema200_4h,
    ema50_1d,
    rsi: rsiVal,
    adx: adx1h?.adx ?? null,
    bbPct,
    vwap: vwapVal ?? null,
    volRatio,
    fundingRate: null, // şimdilik (paket #5+: REST funding fetch)
    atrPercentile: atrPctRes?.percentile ?? null,
    adx4h: adx4h?.adx ?? null,
    ema21_1h,
    closes1h: closes1h.slice(-12), // pullback engine son 8-12 mum
    volumes1h: c1h.slice(-15).map((c) => c.v),
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
  };
}
