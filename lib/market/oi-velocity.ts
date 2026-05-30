/**
 * OI VELOCITY ENGINE — Açık Pozisyon İvmesi Motoru.
 *
 * Anlık OI değil, OI'nin fiyata göre değişim ivmesi hesaplanır.
 * Bu türev sinyal balina katılımını ve squeeze riskini erken tespit eder.
 *
 * Teorik temel:
 *   - Fiyat ↑ + OI ↑ → yeni alıcılar giriyor (agresif long) → bullish
 *   - Fiyat ↓ + OI ↑ → short prestige artıyor → short squeeze riski
 *   - Fiyat ↑ + OI ↓ → long kapanıyor (profit take) → trend zayıflıyor
 *   - Fiyat ↓ + OI ↓ → short kapanıyor (stop hunt) → bear trend yoruluyor
 *
 * İvme (velocity) hesabı:
 *   oiVelocity = dOI/dt  (OI'nin zaman türevi — son N periyotta logaritmik değişim)
 *   normalizedVelocity ∈ [-1, +1] (skor motoruna beslenir)
 *
 * oiVelocityScore ∈ [-10, +10]:
 *   Pozitif: bullish (fiyat↑+OI↑ veya squeeze potansiyeli azalıyor)
 *   Negatif: bearish (fiyat↑+OI↓ veya squeeze riski yüksek)
 *
 * Tüm fonksiyonlar saf (pure) — I/O yok.
 */

import type { Pair } from "@/lib/constants/pairs";

// ─── Tipler ──────────────────────────────────────────────────

/** Tek bir OI veri noktası */
export interface OiSnapshot {
  /** Epoch ms */
  timestamp: number;
  /** Açık pozisyon sayısı (kontrat veya coin cinsinden) */
  openInterest: number;
  /** Anlık fiyat (USDT) — OI ile eş zamanlı */
  price: number;
}

/** OI + Fiyat korelasyon rejimi */
export type OiPriceRegime =
  | "aggressive_long"   // Fiyat↑ OI↑ — yeni long girişi, balina katılımı
  | "short_squeeze_risk" // Fiyat↓ OI↑ — short birikimi, squeeze potansiyeli
  | "long_unwind"       // Fiyat↑ OI↓ — long kapanıyor, güç azalıyor
  | "bear_exhaustion"   // Fiyat↓ OI↓ — short kapanıyor, düşüş yoruluyor
  | "neutral";          // Belirgin sinyal yok

/** OI ivmesi analiz sonucu */
export interface OiVelocityResult {
  /** OI zaman türevi: (OI_son - OI_ilk) / OI_ilk — normalize edilmiş */
  oiChangePct: number;
  /** Fiyat değişimi: (price_son - price_ilk) / price_ilk */
  priceChangePct: number;
  /** Tespit edilen OI–Fiyat rejimi */
  regime: OiPriceRegime;
  /**
   * Skor motoru için normalize edilmiş sinyal: [-10, +10].
   * +10: çok güçlü bullish OI ivmesi
   * -10: çok güçlü bearish / squeeze riski
   *  0: nötr
   */
  oiVelocityScore: number;
  /**
   * İvme büyüklüğü: |oiChangePct|
   * Eşik altı → zayıf sinyal (noise filtrelendi)
   */
  magnitude: "weak" | "moderate" | "strong" | "extreme";
  /** Analiz edilen periyot sayısı */
  periodCount: number;
}

export interface OiVelocityConfig {
  /**
   * OI değişim eşiği — bu altı "nötr" sayılır (noise filtresi).
   * Default %0.5
   */
  minOiChangePct?: number;
  /**
   * Fiyat değişim eşiği — bu altı anlamsız fiyat hareketi.
   * Default %0.3
   */
  minPriceChangePct?: number;
  /** Skor büyüteç faktörü (score = velocity × factor, clamp [-10,+10]). Default 50 */
  scoreFactor?: number;
}

// ─── İvme büyüklük sınıflandırması ──────────────────────────

function classifyMagnitude(absPct: number): OiVelocityResult["magnitude"] {
  if (absPct < 0.5) return "weak";
  if (absPct < 2.0) return "moderate";
  if (absPct < 5.0) return "strong";
  return "extreme";
}

// ─── Rejim tespiti ───────────────────────────────────────────

function detectRegime(
  oiChangePct: number,
  priceChangePct: number,
  minOiPct: number,
  minPricePct: number,
): OiPriceRegime {
  const oiUp = oiChangePct > minOiPct;
  const oiDown = oiChangePct < -minOiPct;
  const priceUp = priceChangePct > minPricePct;
  const priceDown = priceChangePct < -minPricePct;

  if (priceUp && oiUp) return "aggressive_long";
  if (priceDown && oiUp) return "short_squeeze_risk";
  if (priceUp && oiDown) return "long_unwind";
  if (priceDown && oiDown) return "bear_exhaustion";
  return "neutral";
}

// ─── Skor hesabı ─────────────────────────────────────────────

/**
 * Rejim → skor dönüşümü.
 *
 * aggressive_long:    +1 (bullish skor katkısı)
 * bear_exhaustion:    +0.5 (muted bullish)
 * long_unwind:        -0.5 (muted bearish)
 * short_squeeze_risk: -1 (bearish — yeni short açılmaya devam ediyor)
 * neutral:            0
 */
function regimeSign(regime: OiPriceRegime): number {
  switch (regime) {
    case "aggressive_long":    return 1;
    case "bear_exhaustion":    return 0.5;
    case "long_unwind":        return -0.5;
    case "short_squeeze_risk": return -1;
    case "neutral":            return 0;
  }
}

// ─── Ana hesap fonksiyonu ─────────────────────────────────────

/**
 * OI ivmesini hesapla ve skor motoruna beslenecek sinyal üret.
 *
 * @param snapshots   Kronolojik sıralı OI + fiyat veri noktaları (en eski [0])
 * @param pair        Hangi pair (eşik kalibrasyonu için — şimdilik unused, ileride)
 * @param config      Opsiyonel konfigürasyon
 * @returns null → yetersiz veri (en az 2 snapshot gerekli)
 */
export function computeOiVelocity(
  snapshots: readonly OiSnapshot[],
  _pair: Pair,
  config: OiVelocityConfig = {},
): OiVelocityResult | null {
  if (!snapshots || snapshots.length < 2) return null;

  const minOiPct = config.minOiChangePct ?? 0.5;
  const minPricePct = config.minPriceChangePct ?? 0.3;
  const scoreFactor = config.scoreFactor ?? 50;

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  if (first.openInterest <= 0 || first.price <= 0) return null;
  if (last.openInterest <= 0 || last.price <= 0) return null;

  const oiChangePct = ((last.openInterest - first.openInterest) / first.openInterest) * 100;
  const priceChangePct = ((last.price - first.price) / first.price) * 100;

  const regime = detectRegime(oiChangePct, priceChangePct, minOiPct, minPricePct);
  const magnitude = classifyMagnitude(Math.abs(oiChangePct));

  // Skor = rejim yönü × OI değişim büyüklüğü × scoreFactor, clamp [-10, +10]
  const sign = regimeSign(regime);
  const rawScore = sign * Math.abs(oiChangePct / 100) * scoreFactor;
  const oiVelocityScore = Math.max(-10, Math.min(10, parseFloat(rawScore.toFixed(4))));

  return {
    oiChangePct: parseFloat(oiChangePct.toFixed(4)),
    priceChangePct: parseFloat(priceChangePct.toFixed(4)),
    regime,
    oiVelocityScore,
    magnitude,
    periodCount: snapshots.length,
  };
}

/**
 * Çoklu OI serisi için kayan pencere ivmesi.
 * Son N snapshot'ın ortalamasını döner.
 *
 * @param snapshots   Tüm OI geçmişi (kronolojik)
 * @param windowSize  Son kaç snapshot kullanılacak (default 5)
 */
export function computeOiVelocityWindow(
  snapshots: readonly OiSnapshot[],
  pair: Pair,
  windowSize = 5,
  config: OiVelocityConfig = {},
): OiVelocityResult | null {
  if (snapshots.length < 2) return null;
  const window = snapshots.slice(-Math.max(2, windowSize));
  return computeOiVelocity(window, pair, config);
}

/**
 * Normalize edilmiş OI skor [-10, +10] → skor motoruna eklenecek katkı.
 * null → 0 (tarafsız).
 */
export function oiVelocityScoreOrZero(result: OiVelocityResult | null): number {
  return result?.oiVelocityScore ?? 0;
}
